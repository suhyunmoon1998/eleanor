# Eleanor v3 LIVE — Jack Law Brain Expertise Transfer

Eleanor v3 LIVE is the runnable voice application for transferring Jack Josephson's practice into a chronological, implementation-ready Jack Law and CaseSync operating system.

## This is not the demo mode

The application includes a real server-side OpenAI Realtime connection. When the server is configured with `OPENAI_API_KEY`, pressing **Start Eleanor live** opens a WebRTC microphone session, Eleanor speaks and listens in real time, answers are transcribed, structured extraction is run, and the evolving expertise ledger is saved persistently.

The local browser capture controls remain available as a safety fallback, but the default launch path is the live API interviewer.

## Knowledge architecture

- 227 atomic expected triggers form the completeness and programming map.
- 49 natural interview families prevent a repetitive 227-question interview.
- Provisional Jack Law material is loaded before the interview.
- Eleanor asks for corrections, consequential gaps, and expert judgment rather than making Jack reconstruct a blank checklist.
- Case-development and client-development leads are tagged for later dedicated rounds.

## One-command launch

Run:

```bash
node launch.mjs
```

Or use:

- `START_ELEANOR_LIVE.command` on macOS
- `START_ELEANOR_LIVE.bat` on Windows
- `start-eleanor-live.sh` on Linux

The first run asks for the OpenAI API key and writes it to `.env`. The launcher starts the server and opens the browser.

## Manual launch

1. Copy `.env.example` to `.env`.
2. Add `OPENAI_API_KEY`.
3. Run `node server.mjs`.
4. Open `http://localhost:3000`.
5. Press **Start Eleanor live**.

## Live routes

- `GET /api/health` — verifies the live service and API configuration.
- `POST /api/realtime/session` — creates the real WebRTC Realtime session.
- `POST /api/extract` — extracts a conservative structured patch from an answer.
- `POST /api/sessions` — persists the current session and expertise ledger.
- `GET /api/sessions` — lists persisted sessions.
- `GET /api/sessions/:id` — retrieves one persisted session.
- `DELETE /api/sessions/:id` — deletes one persisted session.

Compatibility aliases `/session` and `/extract` are retained.

## Persistent records

Session files are stored under `storage/` by default. Set `SESSION_STORAGE_DIR` to use another path. For hosted deployment, mount a persistent encrypted disk or replace the file store with an approved database.

## Security

- The OpenAI API key stays on the server.
- Set `APP_PASSWORD` to enable HTTP Basic authentication.
- Use HTTPS and access controls outside localhost.
- The server applies restrictive security and microphone headers.
- Do not treat provisional legal shorthand as production deadline logic without current-law and controlling-court verification.

## Docker

```bash
cp .env.example .env
# Add OPENAI_API_KEY and APP_PASSWORD
docker compose up --build
```

Open `http://localhost:3000`.

## Files

- `index.html` — live interview UI and expertise ledger.
- `server.mjs` — Realtime, extraction, persistence, authentication, and static server.
- `launch.mjs` — guided first-run setup and browser launch.
- `eleanor_v3_round1a_prompt.txt` — voice-agent prompt.
- `eleanor_v3_trigger_atlas.json` — 49-family/227-trigger source map.
- `jacklaw_prior_master_list.json` — provisional Jack Law seed material.
- `eleanor_v3_capture_schema.json` — full target ledger schema.
- `Eleanor_v3_Master_Interview_Architecture.md` — interview architecture and rounds.
- `Eleanor_v3_Family_Index.csv` — compact family index.
