# Cards Against AI — MCP Server (Node)

This MCP server demonstrates how to build an MCP Apps backend that drives a game through ChatGPT's model while keeping a real-time widget in sync.

## Key MCP Apps Concepts

- **Tool response structure** — [`buildGameToolResponse`](./src/server.ts#L313) shows the three data channels: `_meta` (widget binding), `content` (model-visible text), and `structuredContent` (widget-visible data).
- **Widget session binding** — [`openai/widgetSessionId`](./src/server.ts#L327) ties all tool responses to the same widget iframe. Without it, each tool call spawns a new widget.
- **Resource registration** — [Widget HTML](./src/server.ts#L448) is served as an MCP resource so ChatGPT can render it. [CSP metadata](./src/server.ts#L466) controls which domains the sandboxed iframe can access.
- **Rules resources** — [`rules://` URIs](./src/server.ts#L478) provide context documents the model reads before acting. They inform behavior, not UI.
- **Tool annotations** — [`toolAnnotations`](./src/server.ts#L420) hint to ChatGPT whether to show confirmation dialogs (readOnlyHint, destructiveHint, openWorldHint).
- **Stateless transport** — [`createCardsAgainstAiServer`](./src/server.ts#L429) creates a fresh McpServer per request. Game state lives in a Map, not in the MCP session.
- **SSE for real-time updates** — [Custom SSE endpoint](./src/server.ts#L938) pushes game state to the widget on every mutation, separate from the MCP protocol.
- **CSP domain configuration** — [CSP setup](./src/server.ts#L75) whitelists origins for the widget's XHR/SSE (connect) and script/image loading (resource).
- **Zod input schemas** — [`registerAppTool`](./src/server.ts#L520) accepts Zod shapes, not JSON Schema. The SDK converts them automatically.

## Setup

### Prerequisites

- Node.js 18+
- pnpm, npm, or yarn

### Install dependencies

From the repository root:

```bash
pnpm install
```

### Build widget assets

```bash
pnpm run build
pnpm run serve
```

The build step generates `assets/cards-against-ai.html` and related bundles. The serve step hosts them on port 4444 so the widget can load its JS and CSS.

### Run the server

```bash
pnpm start
```

The server starts on port 8000 (or `PORT` env var) with a Streamable HTTP endpoint at `POST /mcp`.
