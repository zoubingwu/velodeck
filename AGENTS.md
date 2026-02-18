# TiDB Desktop Architecture Mirror

## Runtime

- Desktop shell: Electrobun (`/Users/zou/workspace/tidb-desktop/src/bun/index.ts`)
- Backend services: Bun + TypeScript (`/Users/zou/workspace/tidb-desktop/src/bun/services`)
- Frontend: React + Vite (`/Users/zou/workspace/tidb-desktop/src/mainview`)
- Shared contracts: `/Users/zou/workspace/tidb-desktop/src/shared/contracts.ts`

## Data Model and Persistence

- Config file: `~/.tidb-desktop/config.json`
- Metadata files: `~/.tidb-desktop/metadata/<connection-id>.json`
- Log file: `~/.tidb-desktop/tidb-desktop.log`
- Agent skills: `~/.tidb-desktop/.agents/skills`

## RPC and Events

- Bun RPC handlers: `/Users/zou/workspace/tidb-desktop/src/bun/rpc.ts`
- Renderer bridge: `/Users/zou/workspace/tidb-desktop/src/mainview/bridge/index.ts`
- Event names:
  - `connection:established`
  - `connection:disconnected`
  - `metadata:extraction:failed`
  - `metadata:extraction:completed`
  - `agent:run:event`
  - `agent:run:status`

## Directory Map

- `/Users/zou/workspace/tidb-desktop/src/index.ts`: app entrypoint
- `/Users/zou/workspace/tidb-desktop/src/bun/index.ts`: window lifecycle and app bootstrap
- `/Users/zou/workspace/tidb-desktop/src/bun/events.ts`: event forwarding to renderer
- `/Users/zou/workspace/tidb-desktop/src/bun/services/config-service.ts`: config and user settings
- `/Users/zou/workspace/tidb-desktop/src/bun/services/db-service.ts`: SQL execution and schema/data APIs
- `/Users/zou/workspace/tidb-desktop/src/bun/services/metadata-service.ts`: metadata extraction and persistence
- `/Users/zou/workspace/tidb-desktop/src/bun/services/session-service.ts`: active connection state
- `/Users/zou/workspace/tidb-desktop/src/bun/services/logger-service.ts`: file + stderr logging
- `/Users/zou/workspace/tidb-desktop/src/bun/services/agent-service.ts`: codex exec runner + `.agents/skills` bootstrap
- `/Users/zou/workspace/tidb-desktop/src/bun/services/agent-bridge-service.ts`: local read-only SQL HTTP bridge for skills
- `/Users/zou/workspace/tidb-desktop/src/mainview/main.tsx`: renderer entrypoint
- `/Users/zou/workspace/tidb-desktop/src/mainview/bridge/index.ts`: frontend API facade replacing Wails `wailsjs`
- `/Users/zou/workspace/tidb-desktop/src/mainview/bridge/models.ts`: frontend `services` type namespace

## Removed Stack

- Wails runtime and generated `wailsjs` bindings
- Go backend (`main.go`, `app.go`, `services/*`, `go.mod`, `go.sum`)

## Quality Gates

- For every future code change, both checks must pass before commit:
  - `bun run typecheck`
  - `bun run lint`
