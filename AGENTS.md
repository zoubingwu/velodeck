# VeloDeck Architecture Mirror

## Runtime

- Desktop shell: Electrobun (`src/bun/index.ts`)
- Backend services: Bun + TypeScript with adapter-based multi-database gateway (`src/bun/services`)
- Frontend: React + Vite (`src/mainview`)
- Shared contracts: `src/shared/contracts.ts`
- Shared RPC schema: `src/shared/rpc-schema.ts`

## Data Model and Persistence

- Config file: `~/.velodeck/config.json`
- Metadata index catalog: `~/.velodeck/.agents/skills/db-index/references/catalog.md`
- Metadata connection index: `~/.velodeck/.agents/skills/db-index/references/<connection-locator>/index.md`
- Metadata namespace docs: `~/.velodeck/.agents/skills/db-index/references/<connection-locator>/<namespace-file>.md`
- Log file: `~/.velodeck/velodeck.log`
- Agent skills: `~/.velodeck/.agents/skills`
- Agent project MCP config: `~/.velodeck/.codex/config.toml`

## RPC and Events

- Bun RPC handlers: `src/bun/rpc.ts` (typed by `AppRPCSchema`)
- Renderer bridge: `src/mainview/bridge/index.ts` (`api` request facade + `onEvent` listener)
- Event forwarding: `src/bun/events.ts` via `webview.rpc.send[...]`
- Event names:
  - `connection:established`
  - `connection:disconnected`
  - `metadata:extraction:failed`
  - `metadata:extraction:completed`
  - `agent:run:event`
  - `agent:run:status`
  - `agent:sql:approval:requested`
  - `agent:sql:approval:resolved`

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
- `src/bun/services/metadata-service.ts`: metadata extraction and markdown index persistence under `.agents/skills/db-index/references`
- `src/bun/services/session-service.ts`: active connection state
- `src/bun/services/logger-service.ts`: file + stderr logging
- `src/bun/services/agent-service.ts`: codex exec runner + `.agents/skills` bootstrap + MCP wiring
- `src/bun/services/agent-mcp-service.ts`: local MCP SQL bridge + write approval flow
- `src/mainview/main.tsx`: renderer entrypoint
- `src/mainview/bridge/index.ts`: typed Electrobun RPC client (`api`) + typed event subscription (`onEvent`)
- `src/shared/rpc-schema.ts`: shared Electrobun RPC contract between Bun and renderer

## Removed Stack

- Wails runtime and generated `wailsjs` bindings
- Go backend (`main.go`, `app.go`, `services/*`, `go.mod`, `go.sum`)

## Quality Gates

- For every future code change, both checks must pass before commit:
  - `bun run typecheck`
  - `bun run lint`
