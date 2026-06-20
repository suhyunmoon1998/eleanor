# Eleanor Vercel Deploy

Use Vercel when you want the fastest free public URL.

## Settings

Import the GitHub repo:

- `suhyunmoon1998/eleanor`

Use these project settings:

- Framework Preset: `Vite`
- Build Command: `npm ci && npm run build:vercel`
- Output Directory: `dist`

The included [vercel.json](/Users/davidmun/Documents/Eleanor/vercel.json) already sets those values for the repo.

## Environment Variables

Add:

- `ELEANOR_API_KEY`

Value:

- your OpenAI API key

## Important Limitation

Vercel Functions do not behave like an always-on server with persistent local files. Eleanor will load and call OpenAI, but interview session persistence should be treated as temporary until we connect a database or Vercel Storage.

Good next storage options:

- Vercel Postgres
- Vercel KV
- Neon Postgres
