# Eleanor Web

Eleanor is a lightweight interview web app for capturing Jack's operational knowledge and turning it into structured follow-up questions and saved session data.

## Local

```bash
npm ci
npm run build:web
npm run start:web
```

Open:

- `http://127.0.0.1:3001`

## Deploy

Recommended target:

- Render Web Service

Files already included for deployment:

- [render.yaml](/Users/davidmun/Documents/Eleanor/render.yaml)
- [DEPLOY_RENDER.md](/Users/davidmun/Documents/Eleanor/DEPLOY_RENDER.md)
- [Dockerfile](/Users/davidmun/Documents/Eleanor/Dockerfile)

## Required Secret

Set this in your host:

- `ELEANOR_API_KEY`

## Notes

- Default provider is `OpenAI`
- Default models are `gpt-5.2` and `gpt-realtime`
- Live voice currently works only with the OpenAI provider
