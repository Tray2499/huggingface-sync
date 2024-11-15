#!/bin/bash
set -e

# 初始化变量
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="$(dirname "$SCRIPT_DIR")"
REPORT_FILE="${BASE_DIR}/reports/sync_report.md"
SPACES_DIR="${BASE_DIR}/spaces"
START_TIME=$(date '+%Y-%m-%d %H:%M:%S')
TOTAL=0
SUCCESS=0
FAILED=0
SKIPPED=0
RESTORED=0
START_SECONDS=$(date +%s)
IN_SPACES_SECTION=false

# 确保必要的目录存在
mkdir -p "${BASE_DIR}/reports"
mkdir -p "${BASE_DIR}/temp_repos"
mkdir -p "${SPACES_DIR}"

# 初始化报告
{
  echo "# 👧 Hugging Face Spaces 同步报告"
  echo ""
  echo "开始时间: $START_TIME"
  echo ""
  echo "## 📝 同步详情"
  echo ""
} > "${REPORT_FILE}"

# 进入临时目录
cd "${BASE_DIR}/temp_repos"

# 读取仓库列表并处理每个仓库
while IFS= read -r line || [ -n "$line" ]; do
  # 跳过空行和注释
  [[ $line =~ ^[[:space:]]*$ || $line =~ ^# ]] && continue
  
  # 检查是否是 spaces 区段标记
  if [[ $line == "[spaces]" ]]; then
    IN_SPACES_SECTION=true
    continue
  elif [[ $line =~ ^\[.*\]$ ]]; then
    IN_SPACES_SECTION=false
    continue
  fi
  
  # 只处理 spaces 区段中的内容
  [ "$IN_SPACES_SECTION" = false ] && continue
  
  # 移除行首行尾的空白字符
  repo=$(echo "$line" | sed 's/^[ \t]*//;s/[ \t]*$//')
  [ -z "$repo" ] && continue
  
  TOTAL=$((TOTAL + 1))
  
  repo_name=$(basename "$repo")
  target_dir="${SPACES_DIR}/${repo}"
  
  # 检查仓库是否存在于 HF
  if curl -s -o /dev/null -w "%{http_code}" "https://huggingface.co/spaces/${repo}" | grep -q "200"; then
    # 仓库存在，尝试克隆
    if git clone "https://huggingface.co/spaces/${repo}" "$repo_name"; then
      size=$(du -sh "$repo_name" | cut -f1)
      
      # 备份现有目录（如果存在）
      if [ -d "$target_dir" ]; then
        backup_dir="${BASE_DIR}/backup/${repo}"
        mkdir -p "$(dirname "$backup_dir")"
        mv "$target_dir" "$backup_dir"
      fi
      
      # 移除.git目录
      rm -rf "$repo_name/.git"
      
      # 创建目标目录的父目录
      mkdir -p "$(dirname "$target_dir")"
      
      {
        echo "### [${repo}](https://huggingface.co/spaces/${repo})"
        echo ""
        echo "* 📦 仓库大小：${size}"
        echo "* ✅ 状态：同步成功"
        echo "* 📂 本地目录：[\`spaces/${repo}\`](file://${target_dir})"
        echo ""
      } >> "${REPORT_FILE}"
      
      # 标记成功
      echo "$target_dir" > "$repo_name.success"
      SUCCESS=$((SUCCESS + 1))
    else
      {
        echo "### [${repo}](https://huggingface.co/spaces/${repo})"
        echo ""
        echo "* ❌ 状态：同步失败"
        echo ""
      } >> "${REPORT_FILE}"
      FAILED=$((FAILED + 1))
    fi
  else
    if [ -d "$target_dir" ]; then
      {
        echo "### [${repo}](https://huggingface.co/spaces/${repo})"
        echo ""
        echo "* ⚠️ 状态：仓库不可访问，保留本地副本"
        echo "* 📂 本地目录：[\`spaces/${repo}\`](file://${target_dir})"
        echo ""
      } >> "${REPORT_FILE}"
      SKIPPED=$((SKIPPED + 1))
    else
      {
        echo "### [${repo}](https://huggingface.co/spaces/${repo})"
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
  find backup -type d -mindepth 2 | while read -r backup_repo; do
    if [ -d "$backup_repo" ]; then
      repo_path=${backup_repo#backup/}
      if [ ! -f "temp_repos/$(basename "$repo_path").success" ]; then
        mkdir -p "$(dirname "${SPACES_DIR}/${repo_path}")"
        mv "$backup_repo" "${SPACES_DIR}/${repo_path}"
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
