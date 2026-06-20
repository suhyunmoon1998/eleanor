FROM node:22-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3001
ENV ELEANOR_WEB_DATA_ROOT=/app/app-data

RUN npm run build:web

EXPOSE 3001

CMD ["npm", "run", "start:web"]
