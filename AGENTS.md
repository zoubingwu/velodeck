# VeloDeck Architecture Mirror

## Runtime

- Desktop shell: Electrobun (`src/bun/index.ts`)
- Backend services: Bun + TypeScript with manifest-driven connector gateway (`src/bun/services`)
- Frontend: React + Vite (`src/mainview`)
- Shared contracts: `src/shared/contracts.ts`
- Shared RPC schema: `src/shared/rpc-schema.ts`

## Data Model and Persistence

- Config file: `~/.velodeck/config.json`
- Metadata index catalog: `~/.velodeck/.agents/skills/db-index/references/catalog.md`
- Metadata connection index: `~/.velodeck/.agents/skills/db-index/references/<connection-locator>/index.md`
- Metadata entity docs: `~/.velodeck/.agents/skills/db-index/references/<connection-locator>/<entity-file>.md`
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
- `src/bun/services/connector-gateway-service.ts`: connector routing, capability exposure, explorer/data APIs, and SQL execution dispatch for SQL connectors
- `src/bun/services/connector-types.ts`: connector contracts (`DataConnector`, `SQLConnector`)
- `src/bun/services/connector-registry.ts`: manifest-driven connector registration and lookup
- `src/bun/connectors/sql-mysql-family-base.ts`: MySQL-family shared implementation
- `src/bun/connectors/mysql-connector.ts`: MySQL connector
- `src/bun/connectors/tidb-connector.ts`: TiDB connector
- `src/bun/connectors/postgres-connector.ts`: PostgreSQL connector
- `src/bun/connectors/sqlite-connector.ts`: SQLite connector
- `src/bun/connectors/bigquery-connector.ts`: BigQuery connector
- `src/bun/utils/bigquery-support.ts`: BigQuery connector auth/query helper utilities
- `src/bun/utils/connector-node-id.ts`: explorer node id encode/decode helpers
- `src/bun/utils/connector-options.ts`: connector option parsing helpers
- `src/bun/utils/sql-types.ts`: SQL connector internal typed connection/table contracts
- `src/bun/utils/sql-utils.ts`: shared SQL filter/quoting/normalization helpers
- `src/bun/services/metadata-service.ts`: metadata extraction and entity-centric markdown index persistence under `.agents/skills/db-index/references`
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
