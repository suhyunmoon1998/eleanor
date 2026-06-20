# Live deployment notes

## Minimum production configuration

Set these environment variables on the server:

```text
OPENAI_API_KEY=...
APP_USERNAME=jacklaw
APP_PASSWORD=a-long-unique-password
PORT=3000
SESSION_STORAGE_DIR=storage
```

Place the service behind HTTPS. The browser microphone requires a secure context when the application is not running on localhost.

## Persistent storage

The included server writes one JSON file per interview session. Mount `storage/` on a persistent encrypted volume. For a multi-user or scaled deployment, replace these routes with a firm-approved database and access-control layer.

## Reverse proxy

The application uses ordinary HTTPS requests for SDP setup, structured extraction, and persistence. The browser then establishes a WebRTC media connection. A standard reverse proxy is sufficient; no application WebSocket proxy is required for this implementation.

## Access control

The built-in Basic authentication is suitable for a small private deployment when combined with HTTPS and a strong password. A firm-wide deployment should generally use the firm's identity provider, audit logging, least-privilege access, and a documented retention policy.

## Backup

Back up the `storage/` directory according to the firm's privileged-data policy. JSON and Markdown exports can also be created within the interface after each session.
