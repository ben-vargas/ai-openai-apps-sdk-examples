# Cards Against AI MCP server (Node)

This directory contains a minimal MCP server implemented with the official
TypeScript SDK. It exposes a single tool to start a Cards Against AI game and
returns an inline widget that renders the "Cards Against AI" header.

## Prerequisites

- Node.js 18+
- pnpm, npm, or yarn for dependency management

## Install dependencies

From the repository root:

```bash
pnpm install
```

If you prefer npm or yarn, adjust the command accordingly.

## Build widget assets

From the repository root:

```bash
pnpm run build
pnpm run serve
```

The build step generates `assets/cards-against-ai.html` and related bundles.
The serve step hosts the assets locally so the widget can load its JS and CSS.

## Run the server

```bash
pnpm start
```

The server starts over SSE (Server-Sent Events), compatible with the MCP
Inspector and ChatGPT connectors.

## MCP request logging

To log MCP request/response details for debugging, set `MCP_LOG=1`:

```bash
MCP_LOG=1 pnpm start
```

You can optionally cap the logged request body size (bytes) via
`MCP_LOG_BODY_BYTES` (default: 4096).
