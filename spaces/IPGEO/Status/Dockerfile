FROM chipsman/uptime-kuma


# 安装 Node.js
RUN apk update && \
    apk add --no-cache nodejs npm

# 设置目录权限
RUN mkdir -p /app/data && chown -R node:node /app

USER node
    
EXPOSE 3001

CMD ["node","server/server.js"]