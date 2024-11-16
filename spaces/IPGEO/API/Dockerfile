FROM python:3.9 as py-builder
WORKDIR /code

# 拷贝依赖文件并安装依赖
COPY ./requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

FROM python:3.9-slim
ENV TZ=Asia/Shanghai
RUN ln -snf /usr/share/zoneinfo/$TZ /etc/localtime && echo $TZ > /etc/timezone

# 安装必要的系统依赖
RUN apt-get update && apt-get install -y curl procps && rm -rf /var/lib/apt/lists/*

WORKDIR /code

# 拷贝依赖和应用代码
COPY --from=py-builder /usr/local/lib/python3.9/site-packages /usr/local/lib/python3.9/site-packages
COPY --from=py-builder /usr/local/bin /usr/local/bin

COPY ./main.py .
COPY ./update_and_restart.sh .

# 设置所有文件和目录的权限为 777
RUN chmod -R 777 /code

# 确保启动脚本可执行
RUN chmod +x /code/update_and_restart.sh

# 容器启动命令
CMD ["sh", "/code/update_and_restart.sh"]
