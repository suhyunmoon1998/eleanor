# Eleanor v3 Task Plan

## Audit Summary

- The working repository was empty aside from `.git`.
- A prior runnable Eleanor app existed in `legacy-live-app/`, but it is a Node + static HTML server, not the required one-click Electron desktop architecture.
- The prior app includes reusable source artifacts:
  - `eleanor_v3_trigger_atlas.json`
  - `Eleanor_v3_Family_Index.csv`
  - `jacklaw_prior_master_list.json`
  - `eleanor_v3_capture_schema.json`
  - `eleanor_v3_round1a_prompt.txt`
  - `Eleanor_v3_Master_Interview_Architecture.md`
- The master build prompt is now copied into `source-materials/` so the repo carries its own implementation brief.

## Build Strategy

1. Import and normalize source materials into deterministic app data under `generated-data/`.
2. Build a secure Electron main-process backend with:
   - encrypted API-key storage via `safeStorage`
   - local app/session persistence
   - trusted OpenAI orchestration
   - renderer-safe IPC only
3. Build the renderer in React + TypeScript with:
   - first-launch setup flow
   - settings management
   - R1A interview workspace
   - progress visibility across families and triggers
4. Preserve and adapt the prior live-app knowledge architecture rather than re-deriving it.
5. Add tests for import logic and core orchestration helpers.
6. Produce installable desktop artifacts through `electron-builder` if the environment allows a full packaging pass.

## Implementation Phases

### Phase 1

- Create the Electron/Vite/TypeScript workspace.
- Implement the source import pipeline.
- Generate normalized data artifacts.

### Phase 2

- Implement secure setup and settings.
- Implement local persistence for interview sessions.
- Build the initial R1A workspace.

### Phase 3

- Add OpenAI connection testing.
- Add Realtime session initialization and structured extraction plumbing.
- Add unit and smoke coverage.
- Run build and packaging verification.

## Known Gaps From Legacy App

- Requires Node and a browser instead of a desktop installer.
- Uses an HTTP server boundary instead of Electron IPC.
- Stores the API key in `.env` rather than encrypted desktop storage.
- Does not satisfy the requested first-launch/settings UX.
- Needs migration from static HTML/Node scripts into maintainable TypeScript modules.
