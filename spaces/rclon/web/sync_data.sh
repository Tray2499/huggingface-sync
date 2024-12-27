

# 检查必要的环境变量
if [ -z "$G_NAME" ] || [ -z "$G_TOKEN" ]; then
    echo "缺少必要的环境变量 G_NAME 或 G_TOKEN"
    exit 1
fi

# 解析仓库名和用户名
IFS='/' read -r GITHUB_USER GITHUB_REPO <<< "$G_NAME"

# 构建 GitHub 仓库的克隆 URL，包含令牌
REPO_URL="https://${G_TOKEN}@github.com/${G_NAME}.git"
mkdir -p  ./data/github_data
# 克隆仓库
echo "正在克隆仓库……"
git clone "$REPO_URL" ./data/github_data || {
    echo "克隆失败，请检查 G_NAME 和 G_TOKEN 是否正确。"
    exit 1
}

if [ -f ./data/github_data/webui.db ]; then
    cp ./data/github_data/webui.db ./data/webui.db
    echo "从 GitHub 仓库中拉取成功"
else
    echo "GitHub 仓库中未找到 webui.db，将在同步时推送"
fi

# 定义同步函数
sync_data() {
    while true; do
        # 1. 同步到 GitHub
        echo "正在开始同步"
        # 进入仓库目录
        cd ./data/github_data
        # 配置 Git 用户信息
        git config user.name "AutoSync Bot"
        git config user.email "autosync@bot.com"

        # 确保在正确的分支
        git checkout main || git checkout master

        # 复制最新的数据库文件
        # cp ../webui.db ./webui.db
        
        if [ -f "../webui.db" ]; then  
            cp ../webui.db ./webui.db  
        else  
            echo "数据库尚未初始化"  
        fi 
        
        # 检查是否有变化
        if [[ -n $(git status -s) ]]; then
            # 添加所有变更
            git add webui.db

            # 提交变更
            git commit -m "Auto sync webui.db $(date '+%Y-%m-%d %H:%M:%S')"

            # 推送到远程仓库
            git push origin HEAD && {
                echo "GitHub推送成功"
            }|| {
                echo "推送失败，等待重试..."
                sleep 10
                git push origin HEAD || {
                    echo "重试失败，放弃推送到Github。"
                }
            }
            # 返回上级目录
            cd ..
            cd ..

            # 2. 同步到 WebDAV
            if [ -z "$WEBDAV_URL" ] || [ -z "$WEBDAV_USERNAME" ] || [ -z "$WEBDAV_PASSWORD" ]; then
                echo "WebDAV 环境变量缺失，跳过 WebDAV 同步。"
            else
                echo "同步到 WebDAV..."
                FILENAME="webui_$(date +'%m_%d').db"
                # 检查是否存在要上传的文件
                if [ -f ./data/webui.db ]; then
                    # 使用 curl 进行文件上传
                    curl -T ./data/webui.db --user "$WEBDAV_USERNAME:$WEBDAV_PASSWORD" "$WEBDAV_URL/$FILENAME" && {
                        echo "WebDAV 上传成功"
                    } || {
                        echo "WebDAV 上传失败，等待重试..."
                        sleep 10
                        curl -T ./data/webui.db --user "$WEBDAV_USERNAME:$WEBDAV_PASSWORD" "$WEBDAV_URL/$FILENAME" || {
                            echo "重试失败，放弃webdav上传。"
                        }
                    }
                else
                    echo "未找到 webui.db 文件，跳过 WebDAV 同步"
                fi
            fi


        else
            # 返回上级目录
            cd ..
            cd ..
            echo "GitHub: 没有检测到数据库变化"
        fi
        # 3. 等待统一的时间间隔
        SYNC_INTERVAL=${SYNC_INTERVAL:-7200}  # 默认间隔时间为 7200 秒
        echo "当前时间 $(date '+%Y-%m-%d %H:%M:%S')"
        echo "等待 ${SYNC_INTERVAL} 秒后进行下一次同步..."
        sleep $SYNC_INTERVAL

    done
}

# 后台启动同步进程
sync_data &