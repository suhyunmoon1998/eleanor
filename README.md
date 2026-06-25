# Eleanor Web

Eleanor is a lightweight local archive web app for capturing Jack's operational knowledge before the Eleanor 2.0 rebuild.

## Local

```bash
npm ci
npm run build:web
npm run start:web
```

Open:

- `http://127.0.0.1:3001`

## Deploy On Vercel

Recommended free-first target:

- Vercel

Files already included:

- [vercel.json](/Users/davidmun/Documents/Eleanor/vercel.json)

Vercel uses serverless functions, so local session data is temporary until a database or Vercel Storage is connected.

## Deploy On Render

Recommended target when persistent local session storage matters:

- Render Web Service

Files already included for deployment:

- [render.yaml](/Users/davidmun/Documents/Eleanor/render.yaml)
- [DEPLOY_RENDER.md](/Users/davidmun/Documents/Eleanor/DEPLOY_RENDER.md)
- [Dockerfile](/Users/davidmun/Documents/Eleanor/Dockerfile)

## Notes

- OpenAI API has been removed.
- Default mode is `local-archive`.
- Use Eleanor to collect notes, copy conversation history, and export a ChatGPT-ready knowledge pack for Eleanor 2.0.
