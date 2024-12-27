FROM calciumion/new-api:latest AS builder

FROM nginx:alpine
COPY --from=builder /one-api /one-api
WORKDIR /data
RUN chmod +x /one-api && \
    mkdir -p /data && chmod 777 /data  && \
    mkdir -p logs && chmod 777 logs   && \
    chmod 777 /var/cache/nginx && \
    mkdir -p /var/log/nginx && chmod 777 /var/log/nginx && \
    touch /var/run/nginx.pid && chmod 777 /var/run/nginx.pid
    
COPY nginx.conf /etc/nginx/nginx.conf
EXPOSE 7860
COPY start.sh /start.sh
RUN chmod +x /start.sh

CMD ["/start.sh"]
