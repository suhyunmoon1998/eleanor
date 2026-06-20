FROM node:22-alpine
WORKDIR /app
COPY . .
RUN mkdir -p /app/storage && chown -R node:node /app
USER node
EXPOSE 3000
CMD ["node", "server.mjs"]
