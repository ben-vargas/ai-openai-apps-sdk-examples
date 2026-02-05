# Cards Against AI — Architecture

## MCP Apps Protocol

Uses `@modelcontextprotocol/ext-apps` — widget communicates via `postMessage` (JSON-RPC), not `window.openai` globals.

**Critical constraint**: `ontoolresult` fires **once per widget lifecycle**. Subsequent LLM tool calls create new widget instances — the existing widget never receives those updates. This means widget-initiated `callServerTool()` return values are the primary state update mechanism.

## Game Loop

```
Human clicks card
  → widget calls app.callServerTool("play-answer-card")
  → captures return value → extracts structuredContent → updates state
  → if nextAction is LLM-dependent:
    → widget calls app.sendMessage() to nudge LLM
    → widget calls watch-game-state (server holds response until change or 45s timeout)
    → on change: updates state, continues watching if still LLM-dependent
    → on timeout: retries immediately
  → repeat until nextAction is human-pending or game-over
```

## State Flow

```
Server (GameInstance)
  → MCP tool response:
      structuredContent: { gameState, gameId, gameKey, nextAction }
  → Initial render: ontoolresult fires once with structuredContent
  → Human actions: callServerTool() returns structuredContent directly
  → LLM actions: widget long-polls via watch-game-state to pick up changes
  → updateToolResultData() pushes new state into McpAppProvider
  → Optimistic updates via localOverride in GameManagementProvider
```

## MCP Tools

| Tool | Initiator | Visibility | Purpose |
|------|-----------|------------|---------|
| `start-game` | LLM | model+app | Create game with players, cards, first prompt |
| `join-game` | Widget | model+app | Human joins an existing game |
| `play-answer-card` | Widget | model+app | Human plays a card from hand |
| `judge-answer-card` | Widget | model+app | Human judge picks winner |
| `submit-cpu-answers` | LLM | model+app | CPU players choose and play cards |
| `submit-cpu-judgement` | LLM | model+app | CPU judge picks winner |
| `submit-prompt` | LLM | model+app | New prompt + replacement cards for next round |
| `watch-game-state` | Widget | **app-only** | Long-poll for state changes after LLM actions |

## Watch Strategy

After a human action (`play-answer-card` or `judge-answer-card`):

1. Widget captures `callServerTool()` return → updates state immediately
2. Checks `nextAction` from the response
3. If LLM-dependent (`submit-cpu-answers`, `submit-cpu-judgement`, `submit-prompt`):
   - Sends `sendMessage()` to nudge the LLM
   - Calls `watch-game-state` with the current `knownStatus`
   - Server holds response up to 45s via `GameInstance.waitForChange()`
   - Response includes `{ type: "change" }` or `{ type: "timeout" }`
   - On `"change"`: updates state, checks `nextAction`, continues if still LLM-dependent
   - On `"timeout"`: retries immediately (state may have changed during timeout window)
   - Widget-side timeout set to 55s (above server's 45s hold) to avoid premature abort
4. If human-pending or game-over: stops, waits for user interaction

## PiP Card Management

`pip-card-management.tsx` uses a reducer to manage card positions with animation states:

- **entering**: Card starts at dealer spot, animates to target position, flips face-up after delay
- **active**: Card at final position
- **exiting**: Card animates to dealer spot, removed on transition end

`buildPipCardStateMap()` computes target positions from game state:
- Prompt card: top center
- Played cards: bottom center row (face-down during `waiting-for-answers`, face-up during `judging`/`display-judgement`)
- Hand cards: bottom center fan (shown until local player has played, hidden for judge)

## CPU Dialog

CPU tool responses include formatted textContent (e.g. character quips when playing cards, judge announcements). ChatGPT presents this naturally in the chat stream — the characters "speak" through model narration.
