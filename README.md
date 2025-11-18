## About

TiDB Desktop is a modern lightweight TiDB/MySQL client with a built-in AI agent.

![screenshot](./screenshot.gif)

## Download

You can download the latest release from the [GitHub Releases page](https://github.com/zoubingwu/tidb-desktop/releases).

## Contribution

### Prerequisites

Make sure you have the following installed:

- Go v1.24
- Node.js v22
- pnpm v10.8.0
- Wails CLI v2.10 (`go install github.com/wailsapp/wails/v2/cmd/wails@v2.10`)

### Development

To run in live development mode:

```bash
wails dev
```

This starts a development server with hot-reloading for frontend changes. You can also access your Go methods from the browser devtools by navigating to `http://localhost:34115`.

### Building

To build a redistributable, production-ready package:

```bash
wails build
```
