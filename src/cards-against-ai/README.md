# Cards Against AI — Widget Code

This widget demonstrates key MCP Apps patterns for building interactive UIs that communicate with both an MCP server and ChatGPT's model.

## Key Concepts

- **Widget initialization** — [`useApp()`](./App.tsx#L36) sets up the MCP Apps postMessage/JSON-RPC connection to the host (ChatGPT).
- **Bootstrapping from tool results** — [`ontoolresult`](./App.tsx#L23) fires on every tool response. Used once to extract the `gameId` from `start-game`.
- **Real-time state via SSE** — [`useStreamingGameState`](./App.tsx#L53) opens an EventSource for live game state updates, independent of tool calls.
- **Direct tool calls** — [`callServerTool`](./PlayArea.tsx#L101) calls the MCP server directly, bypassing the model. Instant, no confirmation dialog.
- **Model-mediated actions** — [`sendMessage`](./PlayArea.tsx#L180) sends a message into the conversation so the model can decide what to do next.
- **Hybrid pattern** — [`callToolAndNotify`](./PlayArea.tsx#L92) combines both: direct call first, then conditionally notifies the model based on `nextAction.notifyModel`.
- **Display modes** — [`requestDisplayMode({ mode: "pip" })`](./App.tsx#L115) keeps the widget visible in picture-in-picture while the user chats.
- **Routing signal** — [`NextActionHint.notifyModel`](./types.ts#L68) tells the widget whether the model needs to act next or if it should wait for human input.

## Architecture

See [DESIGN.md](./DESIGN.md) for the full data flow and game loop.
