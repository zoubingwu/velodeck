## About

TiDB Desktop is a modern lightweight TiDB/MySQL client with a built-in AI agent.

![screenshot](./screenshot.gif)

## Download

You can download the latest release from the [GitHub Releases page](https://github.com/zoubingwu/tidb-desktop/releases).

## Tech Stack

- Desktop runtime: Electrobun
- Backend runtime: Bun + TypeScript
- Frontend: React + Vite
- Storage: `~/.tidb-desktop/config.json` and `~/.tidb-desktop/metadata/*.json`

## Development

### Prerequisites

- Bun v1.3+
- macOS (first-class target in current release workflow)

### Install dependencies

```bash
bun install
```

### Run in dev mode

```bash
bun run dev
```

This builds renderer assets and starts Electrobun against bundled `views://` files.

### Run in HMR mode

```bash
bun run dev:hmr
```

This starts:

- Vite dev server on `http://127.0.0.1:5173`
- Electrobun desktop shell loading the dev server URL

## Build

### Build macOS package

```bash
bun run build:mac
```

### Generic build

```bash
bun run build
```

## Notes

- Window size/position are persisted on close.
- Connection/session, metadata extraction, and app events are bridged through Electrobun RPC.
