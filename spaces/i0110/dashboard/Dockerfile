FROM node:18-alpine

WORKDIR /app

# 安装依赖
COPY package.json .
RUN npm install --production

# 复制代码
COPY . .

# 暴露端口
EXPOSE 8080

# 设置环境变量（可以通过 docker run -e 覆盖）
ENV PORT=8080
ENV HF_USER=""
ENV API_KEY="your_api_key_here"

# 启动应用
CMD ["npm", "start"]