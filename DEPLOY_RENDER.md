# Eleanor Web Deploy

## Recommended

Use Render `Web Service` with the included [render.yaml](/Users/davidmun/Documents/Eleanor/render.yaml).

This app stores:

- interview sessions
- local app settings

Because of that, Render should use a paid instance with a persistent disk if session history must survive redeploys. Render's docs say persistent disks are available on paid web services, and free web services lose local files on redeploy or restart:

- [Blueprint YAML Reference](https://render.com/docs/blueprint-spec)
- [Persistent Disks](https://render.com/docs/disks)
- [Deploy for Free](https://render.com/docs/free)

## What To Set In Render

Create a new Blueprint or Web Service from this repo.

If using the included `render.yaml`, set this secret in the dashboard:

- `ELEANOR_API_KEY`:
  your OpenAI API key

Optional:

- `PORT`:
  Render usually sets this automatically
- `HOST`:
  already set to `0.0.0.0`

## Included Service Settings

- Build command: `npm ci --include=dev && npm run build:web`
- Start command: `npm run start:web`
- Health check: `/api/health`
- Persistent data path: `/opt/render/project/src/app-data`

## Important Notes

- `starter` is used in [render.yaml](/Users/davidmun/Documents/Eleanor/render.yaml) so the app can keep its local session data on a disk.
- If you switch the service to `free`, Render will not preserve local files. That means saved sessions can disappear after restart or redeploy.
- Eleanor reads the API key from `ELEANOR_API_KEY`, so Jack does not need to paste the key into the app.

## Manual Render Setup

If you don't use the Blueprint file, use:

- Runtime: `Node`
- Build Command: `npm ci --include=dev && npm run build:web`
- Start Command: `npm run start:web`
- Health Check Path: `/api/health`
- Instance Type: `Starter` or higher

Then attach a persistent disk:

- Mount path: `/opt/render/project/src/app-data`
- Size: `1 GB`

And add env vars:

- `NODE_ENV=production`
- `HOST=0.0.0.0`
- `ELEANOR_WEB_DATA_ROOT=/opt/render/project/src/app-data`
- `ELEANOR_API_KEY=<your key>`
