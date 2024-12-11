# 使用官方 Node.js 镜像
FROM node:18-alpine

# 设置工作目录
WORKDIR /app

# 安装 @filen/webdav 包
RUN npm install @filen/webdav@latest

# 复制当前目录下的代码到容器中
COPY . .

# 暴露端口
EXPOSE 8080

# 运行代码
CMD ["node", "start.mjs"]
