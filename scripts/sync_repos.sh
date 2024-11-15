#!/bin/bash
set -e

# 初始化变量
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
REPORT_FILE="${BASE_DIR}/reports/sync_report.md"
BASE_STORAGE_DIR="${BASE_DIR}/models"
START_TIME=$(date '+%Y-%m-%d %H:%M:%S')
TOTAL=0
SUCCESS=0
FAILED=0
SKIPPED=0
RESTORED=0
START_SECONDS=$(date +%s)

# 确保必要的目录存在
mkdir -p "${BASE_DIR}/reports"
mkdir -p "${BASE_DIR}/temp_repos"
mkdir -p "${BASE_STORAGE_DIR}"

# 初始化报告
{
  echo "# 👧 Hugging Face 模型同步报告"
  echo ""
  echo "开始时间: $START_TIME"
  echo ""
  echo "## 📝 同步详情"
  echo ""
} > "${REPORT_FILE}"

# 处理仓库路径
process_repo_path() {
  local repo=$1
  # 移除开头的 models/ 或 models/spaces/（如果存在）
  repo=${repo#models/}
  repo=${repo#spaces/}
  # 移除重复的路径部分
  local base_name=$(basename "$repo")
  local dir_name=$(dirname "$repo")
  if [[ "$base_name" == "$dir_name" ]]; then
    echo "$base_name"
  else
    echo "$repo"
  fi
}

# 进入临时目录
cd "${BASE_DIR}/temp_repos"

# 读取仓库列表并处理每个仓库
while IFS= read -r repo || [ -n "$repo" ]; do
  # 跳过空行和注释
  [[ $repo =~ ^[[:space:]]*$ || $repo =~ ^# ]] && {
    SKIPPED=$((SKIPPED + 1))
    continue
  }
  
  TOTAL=$((TOTAL + 1))
  
  # 处理仓库路径
  clean_repo=$(process_repo_path "$repo")
  repo_name=$(basename "$clean_repo")
  target_dir="${BASE_STORAGE_DIR}/spaces/${clean_repo}"
  
  # 检查仓库是否存在于 HF
  if curl -s -o /dev/null -w "%{http_code}" "https://huggingface.co/spaces/$clean_repo" | grep -q "200"; then
    # 仓库存在，尝试克隆
    if git clone "https://huggingface.co/spaces/$clean_repo" "$repo_name"; then
      size=$(du -sh "$repo_name" | cut -f1)
      
      # 备份现有目录（如果存在）
      if [ -d "$target_dir" ]; then
        backup_dir="${BASE_DIR}/backup/spaces/${clean_repo}"
        mkdir -p "$(dirname "$backup_dir")"
        mv "$target_dir" "$backup_dir"
      fi
      
      # 移除.git目录
      rm -rf "$repo_name/.git"
      
      # 创建目标目录的父目录
      mkdir -p "$(dirname "$target_dir")"
      
      {
        echo "### [${clean_repo}](https://huggingface.co/spaces/${clean_repo})"
        echo ""
        echo "* 📦 仓库大小：${size}"
        echo "* ✅ 状态：同步成功"
        echo "* 📂 本地目录：[\`models/spaces/${clean_repo}\`](file://${target_dir})"
        echo ""
      } >> "${REPORT_FILE}"
      
      # 标记成功
      echo "$target_dir" > "$repo_name.success"
      SUCCESS=$((SUCCESS + 1))
    else
      {
        echo "### [${clean_repo}](https://huggingface.co/spaces/${clean_repo})"
        echo ""
        echo "* ❌ 状态：同步失败"
        echo ""
      } >> "${REPORT_FILE}"
      FAILED=$((FAILED + 1))
    fi
  else
    if [ -d "$target_dir" ]; then
      {
        echo "### [${clean_repo}](https://huggingface.co/spaces/${clean_repo})"
        echo ""
        echo "* ⚠️ 状态：仓库不可访问，保留本地副本"
        echo "* 📂 本地目录：[\`models/spaces/${clean_repo}\`](file://${target_dir})"
        echo ""
      } >> "${REPORT_FILE}"
      SKIPPED=$((SKIPPED + 1))
    else
      {
        echo "### [${clean_repo}](https://huggingface.co/spaces/${clean_repo})"
        echo ""
        echo "* ⚠️ 状态：仓库不存在"
        echo ""
      } >> "${REPORT_FILE}"
      FAILED=$((FAILED + 1))
    fi
  fi
done < "${BASE_DIR}/huggingface-repos.txt"

# 返回主目录
cd "${BASE_DIR}"

# 只移动成功同步的仓库
for success_file in temp_repos/*.success; do
  if [ -f "$success_file" ]; then
    target_path=$(cat "$success_file")
    repo_name=$(basename "$success_file" .success)
    if [ -d "temp_repos/$repo_name" ]; then
      mkdir -p "$(dirname "$target_path")"
      mv "temp_repos/$repo_name" "$target_path"
    fi
  fi
done

# 恢复未能成功同步的仓库的备份
if [ -d "backup" ]; then
  find backup -type d -mindepth 3 | while read -r backup_repo; do
    if [ -d "$backup_repo" ]; then
      repo_path=${backup_repo#backup/}
      if [ ! -f "temp_repos/$(basename "$repo_path").success" ]; then
        mkdir -p "$(dirname "${BASE_STORAGE_DIR}/${repo_path}")"
        mv "$backup_repo" "${BASE_STORAGE_DIR}/${repo_path}"
        RESTORED=$((RESTORED + 1))
      fi
    fi
  done
  rm -rf backup
fi

# 清理临时文件
rm -rf temp_repos

# 计算总耗时
END_SECONDS=$(date +%s)
DURATION=$((END_SECONDS - START_SECONDS))

# 添加统计信息到报告
{
  echo "## 📊 统计信息"
  echo ""
  echo "* 总仓库数: ${TOTAL}"
  echo "* 成功同步: ${SUCCESS}"
  echo "* 同步失败: ${FAILED}"
  echo "* 跳过同步: ${SKIPPED}"
  echo "* 恢复备份: ${RESTORED}"
  echo "* 总耗时: ${DURATION} 秒"
  echo ""
  echo "完成时间: $(date '+%Y-%m-%d %H:%M:%S')"
} >> "${REPORT_FILE}"
