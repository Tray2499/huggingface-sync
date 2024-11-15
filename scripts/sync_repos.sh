#!/bin/bash
set -e

# 初始化变量
REPORT_FILE="reports/sync_report.md"
BASE_STORAGE_DIR="models"  # 新增：基础存储目录
START_TIME=$(date '+%Y-%m-%d %H:%M:%S')
TOTAL=0
SUCCESS=0
FAILED=0
SKIPPED=0
RESTORED=0
START_SECONDS=$(date +%s)

# 初始化报告
{
  echo "# 👧 Hugging Face 模型同步报告"
  echo ""
  echo "开始时间: $START_TIME"
  echo ""
  echo "## 📝 同步详情"
  echo ""
} > "${REPORT_FILE}"

# 进入临时目录
cd temp_repos

# 读取仓库列表并处理每个仓库
while IFS= read -r repo || [ -n "$repo" ]; do
  # 跳过空行和注释
  [[ $repo =~ ^[[:space:]]*$ || $repo =~ ^# ]] && {
    SKIPPED=$((SKIPPED + 1))
    continue
  }
  
  TOTAL=$((TOTAL + 1))
  repo_name=$(basename "$repo")
  user_name=$(dirname "$repo")  # 新增：获取用户名
  
  # 检查仓库是否存在于 HF
  if curl -s -o /dev/null -w "%{http_code}" "https://huggingface.co/$repo" | grep -q "200"; then
    # 仓库存在，尝试克隆
    if git clone "https://huggingface.co/$repo" "$repo_name"; then
      size=$(du -sh "$repo_name" | cut -f1)
      
      # 创建用户目录结构
      user_dir="../${BASE_STORAGE_DIR}/${user_name}"
      mkdir -p "$user_dir"
      
      {
        echo "### [${repo}](https://huggingface.co/${repo})"
        echo ""
        echo "* 📦 仓库大小：${size}"
        echo "* ✅ 状态：同步成功"
        echo "* 📂 本地目录：[\`${BASE_STORAGE_DIR}/${repo}\`](file://${BASE_STORAGE_DIR}/${repo})"
        echo ""
      } >> "../${REPORT_FILE}"
      
      # 如果克隆成功，将旧版本移动到 backup 目录
      if [ -d "../${BASE_STORAGE_DIR}/$repo" ]; then
        mkdir -p "../backup/${user_name}"
        mv "../${BASE_STORAGE_DIR}/$repo" "../backup/${user_name}/"
      fi
      
      # 移除.git目录使其成为独立副本
      rm -rf "$repo_name/.git"
      
      # 标记这个仓库已成功同步
      echo "${user_dir}/${repo_name}" > "$repo_name.success"
      SUCCESS=$((SUCCESS + 1))
    else
      {
        echo "### [${repo}](https://huggingface.co/${repo})"
        echo ""
        echo "* ❌ 状态：同步失败"
        echo ""
      } >> "../${REPORT_FILE}"
      FAILED=$((FAILED + 1))
    fi
  else
    if [ -d "../${BASE_STORAGE_DIR}/$repo" ]; then
      {
        echo "### [${repo}](https://huggingface.co/${repo})"
        echo ""
        echo "* ⚠️ 状态：仓库不可访问，保留本地副本"
        echo "* 📂 本地目录：[\`${BASE_STORAGE_DIR}/${repo}\`](file://${BASE_STORAGE_DIR}/${repo})"
        echo ""
      } >> "../${REPORT_FILE}"
      SKIPPED=$((SKIPPED + 1))
    else
      {
        echo "### [${repo}](https://huggingface.co/${repo})"
        echo ""
        echo "* ⚠️ 状态：仓库不存在"
        echo ""
      } >> "../${REPORT_FILE}"
      FAILED=$((FAILED + 1))
    fi
  fi
done < ../huggingface-repos.txt

# 返回主目录
cd ..

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
