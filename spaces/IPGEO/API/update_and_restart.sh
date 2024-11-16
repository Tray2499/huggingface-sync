#!/bin/sh

while true; do
    date
    echo "Updating GeoLite2-City.mmdb..."
    curl -L -o "GeoLite2-City.mmdb" "https://github.com/P3TERX/GeoLite.mmdb/raw/download/GeoLite2-City.mmdb" || { echo "Failed to update GeoLite2-City.mmdb"; continue; }
    
    echo "Updating GeoLite2-ASN.mmdb..."
    curl -L -o "GeoLite2-ASN.mmdb" "https://github.com/P3TERX/GeoLite.mmdb/raw/download/GeoLite2-ASN.mmdb" || { echo "Failed to update GeoLite2-ASN.mmdb"; continue; }
    
    echo "Updating GeoCN.mmdb..."
    curl -L -o "GeoCN.mmdb" "http://github.com/ljxi/GeoCN/releases/download/Latest/GeoCN.mmdb" || { echo "Failed to update GeoCN.mmdb"; continue; }

    echo "Attempting to restart uvicorn..."
    pkill -f "uvicorn"
    
    nohup uvicorn main:app --host 0.0.0.0 --port 8080 --no-server-header --proxy-headers &
    
    # 等待一段时间检查服务是否成功启动
    sleep 5
    
    # 检查 uvicorn 是否正在运行
    if pgrep -f "uvicorn" > /dev/null; then
        echo "uvicorn restarted successfully."
    else
        echo "Failed to restart uvicorn, retrying..."
        continue
    fi

    # 每隔一段时间更新一次数据
    sleep 86400
done
