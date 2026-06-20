# START HERE — Eleanor v3 LIVE

This is the live application, not the static rehearsal page.

It connects the browser microphone to the OpenAI Realtime API, lets Eleanor conduct the interview by voice, transcribes Jack's answers, extracts structured practice knowledge, and saves the session on the Eleanor server.

## First launch on Mac

1. Install Node.js 20 or newer if it is not already installed.
2. Double-click `START_ELEANOR_LIVE.command`.
3. On the first run, paste the OpenAI API key when asked.
4. Eleanor opens in the browser.
5. Press **Start Eleanor live** and allow microphone access.

## First launch on Windows

1. Install Node.js 20 or newer if it is not already installed.
2. Double-click `START_ELEANOR_LIVE.bat`.
3. On the first run, paste the OpenAI API key when asked.
4. Eleanor opens in the browser.
5. Press **Start Eleanor live** and allow microphone access.

## Terminal launch

```bash
node launch.mjs
```

The first-run setup writes a private `.env` file. The permanent API key remains on the server and is never inserted into browser JavaScript.

## What is live

- Native speech-to-speech conversation through `gpt-realtime`.
- Semantic voice activity detection and interruption handling.
- Input transcription using the configured transcription model.
- Structured extraction of each substantive answer.
- The 227-trigger atlas grouped into 49 efficient interview families.
- Server-side persistent session records under `storage/`.
- Browser resume, JSON export, Markdown export, and local audio recording.
- Optional Basic authentication for any non-local deployment.

## Important operating note

The application can capture and organize privileged or confidential material. Before making it internet-accessible, set `APP_PASSWORD`, use HTTPS, restrict access, and use a firm-approved hosting and retention configuration.
