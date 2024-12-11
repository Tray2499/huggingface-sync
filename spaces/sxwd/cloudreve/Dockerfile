# 使用基础镜像
FROM debian:latest

# 安装必要的工具
RUN apt-get update && apt-get install -y \
    wget \
    tar
RUN apt-get update && apt-get install -y aria2
# 设置工作目录
WORKDIR /app

# 下载并解压Cloudreve
RUN wget https://github.com/cloudreve/Cloudreve/releases/download/3.8.3/cloudreve_3.8.3_linux_amd64.tar.gz \
    && tar -zxvf cloudreve_3.8.3_linux_amd64.tar.gz \
    && rm cloudreve_3.8.3_linux_amd64.tar.gz

# 更改 /app 目录的权限
RUN chmod 777 /app
COPY conf.ini /app/conf.ini
COPY aria2.conf /app/aria2.conf
# 赋予执行权限
RUN chmod +x ./cloudreve
# 创建 /aria2/data 目录
RUN mkdir -p /aria2/data

# 更改 /aria2/data 目录的权限
RUN chmod 777 /aria2/data
# 暴露端口
EXPOSE 7860

# # 启动 Cloudreve
# CMD ["./cloudreve","-c","/app/conf.ini"]
COPY start.sh /app/start.sh
RUN chmod +x /app/start.sh
CMD ["/app/start.sh"]