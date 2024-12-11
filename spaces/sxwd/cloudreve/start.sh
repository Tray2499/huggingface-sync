#!/bin/bash
# 启动 aria2
aria2c --conf-path=/app/aria2.conf & 
# 启动 Cloudreve
./cloudreve -c /app/conf.ini