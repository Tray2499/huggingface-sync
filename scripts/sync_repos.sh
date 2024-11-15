#!/bin/bash
set -e

# 初始化变量
REPORT_FILE="reports/sync_report.md"
START_TIME=$(date '+%Y-%m-%d %H:%M:%S')
TOTAL=0
SUCCESS=0
FAILED=0
SKIPPED=0
RESTORED=0
START_SECONDS=$(date +%s)

# 初始化报告
{
  echo "# 🤗 Hugging Face 模型同步报告"
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
  
  # 检查仓库是否存在于 HF
  if curl -s -o /dev/null -w "%{http_code}" "https://huggingface.co/$repo" | grep -q "200"; then
    # 仓库存在，尝试克隆
    if git clone "https://huggingface.co/$repo" "$repo_name"; then
      size=$(du -sh "$repo_name" | cut -f1)
      {
        echo "### [${repo}](https://huggingface.co/${repo})"
        echo ""
        echo "* 📦 仓库大小：${size}"
        echo "* ✅ 状态：同步成功"
        echo ""
      } >> "../${REPORT_FILE}"
      
      # 如果克隆成功，将旧版本移动到 backup 目录
      if [ -d "../$repo_name" ]; then
        mkdir -p ../backup
        mv "../$repo_name" "../backup/$repo_name"
      fi
      
      # 移除.git目录使其成为独立副本
      rm -rf "$repo_name/.git"
      
      # 标记这个仓库已成功同步
      touch "$repo_name.success"
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
    if [ -d "../$repo_name" ]; then
      {
        echo "### [${repo}](https://huggingface.co/${repo})"
        echo ""
        echo "* ⚠️ 状态：仓库不可访问，保留本地副本"
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
for repo in temp_repos/*.success; do
  if [ -f "$repo" ]; then
    repo_name=$(basename "$repo" .success)
    if [ -d "temp_repos/$repo_name" ]; then
      mv "temp_repos/$repo_name" ./
    fi
  fi
done

# 恢复未能成功同步的仓库的备份
if [ -d "backup" ]; then
  for backup in backup/*; do
    if [ -d "$backup" ]; then
      repo_name=$(basename "$backup")
      if [ ! -f "temp_repos/$repo_name.success" ]; then
        mv "$backup" ./
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
