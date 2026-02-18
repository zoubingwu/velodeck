# VeloDeck Architecture Mirror

## Runtime

- Desktop shell: Electrobun (`src/bun/index.ts`)
- Backend services: Bun + TypeScript with adapter-based multi-database gateway (`src/bun/services`)
- Frontend: React + Vite (`src/mainview`)
- Shared contracts: `src/shared/contracts.ts`

## Data Model and Persistence

- Config file: `~/.velodeck/config.json`
- Metadata files: `~/.velodeck/metadata/<connection-id>.json`
- Log file: `~/.velodeck/velodeck.log`
- Agent skills: `~/.velodeck/.agents/skills`

## RPC and Events

- Bun RPC handlers: `src/bun/rpc.ts`
- Renderer bridge: `src/mainview/bridge/index.ts`
- Event names:
  - `connection:established`
  - `connection:disconnected`
  - `metadata:extraction:failed`
  - `metadata:extraction:completed`
  - `agent:run:event`
  - `agent:run:status`

## Directory Map

- `src/index.ts`: app entrypoint
- `src/bun/index.ts`: window lifecycle and app bootstrap
- `src/bun/events.ts`: event forwarding to renderer
- `src/bun/services/config-service.ts`: config and user settings
- `src/bun/services/database-gateway-service.ts`: adapter routing, capability exposure, SQL/schema/data APIs
- `src/bun/services/db-adapters/types.ts`: adapter contracts
- `src/bun/services/db-adapters/registry.ts`: adapter registration and lookup
- `src/bun/services/db-adapters/mysql-adapter.ts`: MySQL/TiDB adapter implementation
- `src/bun/services/db-adapters/postgres-adapter.ts`: PostgreSQL adapter implementation
- `src/bun/services/db-adapters/sqlite-adapter.ts`: SQLite adapter implementation
- `src/bun/services/db-adapters/bigquery-adapter.ts`: BigQuery adapter implementation
- `src/bun/services/metadata-service.ts`: metadata extraction and persistence
- `src/bun/services/session-service.ts`: active connection state
- `src/bun/services/logger-service.ts`: file + stderr logging
- `src/bun/services/agent-service.ts`: codex exec runner + `.agents/skills` bootstrap
- `src/bun/services/agent-bridge-service.ts`: local read-only SQL HTTP bridge for skills
- `src/mainview/main.tsx`: renderer entrypoint
- `src/mainview/bridge/index.ts`: frontend API facade replacing Wails `wailsjs`
- `src/mainview/bridge/models.ts`: frontend `services` type namespace

## Removed Stack

- Wails runtime and generated `wailsjs` bindings
- Go backend (`main.go`, `app.go`, `services/*`, `go.mod`, `go.sum`)

## Quality Gates

- For every future code change, both checks must pass before commit:
  - `bun run typecheck`
  - `bun run lint`
