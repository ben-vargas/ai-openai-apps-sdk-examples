# Cards Against AI — Architecture

## MCP Apps Protocol

Uses `@modelcontextprotocol/ext-apps` — widget communicates via `postMessage` (JSON-RPC), not `window.openai` globals.

## Data Channels

Hybrid approach — two mechanisms for widget→server communication, plus SSE for state delivery:

1. **`callServerTool`** — direct tool calls that bypass the model. Used for `play-answer-card` and `judge-answer-card`. No confirmation dialog, instant execution.
2. **`sendMessage`** — routes through the model. Used when the model must generate content: `advance-cpu-turn` (after play-answer-card returns that nextAction), `submit-prompt` (next round).
3. **SSE** (`/mcp/game/:gameId/state-stream`) — server pushes full `gameState` on every state change. Single `EventSource` per game, opened when `gameId` is known.

`ontoolresult` is kept solely for bootstrapping: it delivers the initial `gameId` from `start-game`, which opens the SSE connection.

All tool responses include `_meta["openai/widgetSessionId"]` = gameId.

## Game Loop

```
Human clicks answer card
  → widget calls callServerTool("play-answer-card") → server updates state → SSE pushes
  → if nextAction is advance-cpu-turn: widget sends sendMessage → LLM calls advance-cpu-turn → SSE pushes
  → if nextAction is human-judge-pending: widget shows judge UI (via SSE state)

Human judges card
  → widget calls callServerTool("judge-answer-card") → server updates state → SSE pushes
  → no model involvement needed

Human clicks "Next Round"
  → widget sends sendMessage("Call submit-prompt for gameId=...")
  → LLM calls submit-prompt → server updates state → SSE pushes
```

## MCP Tools

| Tool | Initiator | Purpose |
|------|-----------|---------|
| `start-game` | LLM | Create game with players, cards, first prompt |
| `play-answer-card` | Widget (callServerTool) | Human plays a card (idempotent) |
| `judge-answer-card` | Widget (callServerTool) | Human judge picks winner (idempotent) |
| `advance-cpu-turn` | LLM (via sendMessage) | CPU answers + optional CPU judgement (single call) |
| `submit-prompt` | LLM (via sendMessage) | New prompt + replacement cards for next round |

## CPU Dialog

CPU tool responses include formatted textContent (e.g. character quips when playing cards, judge announcements). ChatGPT presents this naturally in the chat stream.
