FROM searxng/searxng:latest
ENV SEARXNG_BASE_URL=https://${SEARXNG_HOSTNAME:-localhost}/
RUN mkdir /etc/searxng \
  && chmod 777 /etc/searxng
COPY ./searxng /etc/searxng
