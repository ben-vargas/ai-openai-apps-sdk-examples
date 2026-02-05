import { createFakeAnswerDeck } from "./fetchAnswerDeck";
import { createFakePlayers } from "./fetchPlayers";

interface DevGameCache {
  gameId: string;
  gameKey: string;
  playerId: string;
}

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id?: number | string;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id?: number | string;
  result?: unknown;
  error?: { code: number; message: string };
}

interface McpToolResult {
  content?: Array<{ type: string; text?: string }>;
  structuredContent?: Record<string, unknown>;
  _meta?: Record<string, unknown>;
  isError?: boolean;
}

interface DevWindow extends Window {
  __cardsAgainstAiDevInit?: boolean;
}

const DEV_GAME_CACHE_KEY = "cards-against-ai-dev-game";
const DEFAULT_PLAYER_ID = "player-001";
const MCP_URL = "http://localhost:8000/mcp";

function readDevGameCache(devWindow: DevWindow): DevGameCache | null {
  try {
    const cachedRaw = devWindow.sessionStorage.getItem(DEV_GAME_CACHE_KEY);
    if (!cachedRaw) {
      return null;
    }
    const parsed = JSON.parse(cachedRaw) as Partial<DevGameCache>;
    if (
      typeof parsed.gameId === "string" &&
      typeof parsed.gameKey === "string" &&
      typeof parsed.playerId === "string"
    ) {
      return {
        gameId: parsed.gameId,
        gameKey: parsed.gameKey,
        playerId: parsed.playerId,
      };
    }
  } catch {
    return null;
  }

  return null;
}

function writeDevGameCache(devWindow: DevWindow, cache: DevGameCache): void {
  try {
    devWindow.sessionStorage.setItem(
      DEV_GAME_CACHE_KEY,
      JSON.stringify(cache),
    );
  } catch {
    // ignore cache write errors
  }
}

/**
 * Call a tool on the local MCP server using StreamableHTTP (stateless POST).
 */
async function callLocalMcpTool(
  name: string,
  args: Record<string, unknown>,
): Promise<McpToolResult | null> {
  // StreamableHTTP stateless: single POST with JSON-RPC messages
  // We need to initialize + call tool in sequence

  // Step 1: Initialize
  const initResponse = await fetch(MCP_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "accept": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2024-11-05",
        clientInfo: { name: "cards-ai-dev", version: "0.0.0" },
        capabilities: {},
      },
    }),
  });
  await initResponse.json();

  // Step 2: Send initialized notification (fire-and-forget in stateless mode)
  await fetch(MCP_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "accept": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
  });

  // Step 3: Call the tool
  const toolResponse = await fetch(MCP_URL, {
    method: "POST",
    headers: { "content-type": "application/json", "accept": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });

  const toolJson = (await toolResponse.json()) as JsonRpcResponse;
  if (toolJson.error) {
    console.error("[dev] MCP tool error:", toolJson.error);
    return null;
  }
  return (toolJson.result as McpToolResult) ?? null;
}

/**
 * Extract game payload from MCP tool result.
 */
function extractGamePayload(
  result: McpToolResult | null,
): { gameId?: string; gameKey?: string } | null {
  if (!result) return null;

  if (result.structuredContent) {
    const data = result.structuredContent as { gameId?: string; gameKey?: string };
    if (data.gameId && data.gameKey) return data;
  }

  return null;
}

/**
 * Dev helper that simulates the MCP Apps host protocol via postMessage.
 *
 * When running in dev mode (vite dev server, not inside ChatGPT), the App's
 * `useApp()` hook will try to connect to window.parent via postMessage.
 * Since window.parent === window in dev, we intercept those messages and
 * act as a mock host, proxying tool calls to the local MCP server.
 */
export async function initCardsAgainstAiDevHelper(): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }

  const devWindow = window as DevWindow;

  devWindow.__APP_URL_CONFIG__ ??= {
    assetsBaseUrl: "http://localhost:4444",
  };

  const devSearchParams = new URLSearchParams(devWindow.location.search);

  // If ?dev= param is set, skip MCP connection entirely — dev scenarios provide mock state
  if (devSearchParams.has("dev")) {
    return;
  }

  if (devWindow.__cardsAgainstAiDevInit) {
    return;
  }
  devWindow.__cardsAgainstAiDevInit = true;

  // State for the dev host mock
  let currentGameId: string | null = null;
  let currentGameKey: string | null = null;
  const devPlayerParam = devSearchParams.get("playerId")?.trim() || null;
  const cachedGame = readDevGameCache(devWindow);
  const resolvedPlayerId = devPlayerParam ?? cachedGame?.playerId ?? DEFAULT_PLAYER_ID;

  // Listen for postMessage from the App (useApp hook sends JSON-RPC over postMessage)
  window.addEventListener("message", async (event) => {
    if (!event.data || typeof event.data !== "object") return;
    const msg = event.data as JsonRpcRequest;
    if (msg.jsonrpc !== "2.0") return;

    // Handle ui/initialize request from the App
    if (msg.method === "ui/initialize" && msg.id !== undefined) {
      // Build initial host context with tool info
      const hostContext: Record<string, unknown> = {
        theme: window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light",
        displayMode: "pip",
        availableDisplayModes: ["inline", "pip", "fullscreen"],
      };

      // Respond with initialization result
      const response: JsonRpcResponse = {
        jsonrpc: "2.0",
        id: msg.id,
        result: {
          protocolVersion: "2026-01-26",
          hostInfo: { name: "cards-ai-dev-host", version: "0.0.0" },
          hostCapabilities: {
            serverTools: {},
            message: { text: {} },
          },
          hostContext,
        },
      };
      window.postMessage(response, "*");

      // Auto-start a game after initialization
      setTimeout(() => {
        void autoStartGame(devWindow, resolvedPlayerId, cachedGame);
      }, 100);
      return;
    }

    // Handle ui/notifications/initialized (no response needed)
    if (msg.method === "ui/notifications/initialized") {
      return;
    }

    // Handle ui/notifications/size-changed (no response needed)
    if (msg.method === "ui/notifications/size-changed") {
      return;
    }

    // Handle tools/call — proxy to local MCP server
    if (msg.method === "tools/call" && msg.id !== undefined) {
      const params = msg.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
      if (!params?.name) {
        window.postMessage({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32600, message: "Missing tool name" },
        } satisfies JsonRpcResponse, "*");
        return;
      }

      try {
        const result = await callLocalMcpTool(params.name, params.arguments ?? {});
        // Send the tool call result back
        window.postMessage({
          jsonrpc: "2.0",
          id: msg.id,
          result: result ?? { content: [] },
        } satisfies JsonRpcResponse, "*");

        // Also send a tool-result notification (the host sends this to the App)
        window.postMessage({
          jsonrpc: "2.0",
          method: "ui/notifications/tool-result",
          params: { ...(result ?? { content: [] }) },
        } satisfies JsonRpcRequest, "*");

        // Track game state from result
        const payload = extractGamePayload(result);
        if (payload?.gameId) currentGameId = payload.gameId;
        if (payload?.gameKey) currentGameKey = payload.gameKey;

        if (currentGameId && currentGameKey) {
          writeDevGameCache(devWindow, {
            gameId: currentGameId,
            gameKey: currentGameKey,
            playerId: resolvedPlayerId,
          });
        }
      } catch (error) {
        window.postMessage({
          jsonrpc: "2.0",
          id: msg.id,
          error: { code: -32000, message: error instanceof Error ? error.message : "Tool call failed" },
        } satisfies JsonRpcResponse, "*");
      }
      return;
    }

    // Handle ui/message (chat message from widget)
    if (msg.method === "ui/message" && msg.id !== undefined) {
      const params = msg.params as { content?: Array<{ type: string; text?: string }> } | undefined;
      const text = params?.content?.[0]?.text ?? "";
      console.info("[dev-host] message from widget:", text);
      window.postMessage({
        jsonrpc: "2.0",
        id: msg.id,
        result: {},
      } satisfies JsonRpcResponse, "*");
      return;
    }

    // Handle ui/request-display-mode
    if (msg.method === "ui/request-display-mode" && msg.id !== undefined) {
      const params = msg.params as { mode?: string } | undefined;
      const mode = params?.mode ?? "inline";
      console.info("[dev-host] display mode requested:", mode);
      window.postMessage({
        jsonrpc: "2.0",
        id: msg.id,
        result: { mode },
      } satisfies JsonRpcResponse, "*");
      return;
    }
  });
}

async function autoStartGame(
  devWindow: DevWindow,
  resolvedPlayerId: string,
  cachedGame: DevGameCache | null,
): Promise<void> {
  const devSearchParams = new URLSearchParams(devWindow.location.search);
  const devGameId = devSearchParams.get("gameId")?.trim() || null;
  const devGameKey = devSearchParams.get("gameKey")?.trim() || null;

  // If explicit game params provided, send tool input + result
  if (devGameId && devGameKey) {
    writeDevGameCache(devWindow, {
      gameId: devGameId,
      gameKey: devGameKey,
      playerId: resolvedPlayerId,
    });
    return;
  }

  try {
    const players = createFakePlayers();
    const ownerTemplate = players[0];
    const owner = {
      id: resolvedPlayerId,
      persona: ownerTemplate.persona,
    };
    const joinGameKey = devGameKey ?? cachedGame?.gameKey ?? null;

    if (joinGameKey) {
      try {
        const joinResult = await callLocalMcpTool("join-game", {
          gameKey: joinGameKey,
          player: owner,
        });
        const joinPayload = extractGamePayload(joinResult);

        if (joinPayload?.gameId && joinPayload.gameKey) {
          writeDevGameCache(devWindow, {
            gameId: joinPayload.gameId,
            gameKey: joinPayload.gameKey,
            playerId: resolvedPlayerId,
          });
          // Send tool-input notification
          sendDevNotification("ui/notifications/tool-input", {
            arguments: { gameKey: joinGameKey, player: owner },
          });
          // Send tool-result notification
          sendDevNotification("ui/notifications/tool-result", { ...(joinResult ?? { content: [] }) });
          return;
        }
      } catch (error) {
        console.warn("Dev helper failed to join cached game", error);
      }
    }

    const otherPlayers: Array<{
      type: "cpu";
      persona: typeof ownerTemplate.persona;
    }> = [];
    const cpuTemplates = players.slice(1);
    let cpuIndex = 0;
    while (otherPlayers.length < 3) {
      const template = cpuTemplates[cpuIndex] ?? ownerTemplate;
      otherPlayers.push({ type: "cpu", persona: template.persona });
      cpuIndex += 1;
    }

    const answerDeck = createFakeAnswerDeck();
    const result = await callLocalMcpTool("start-game", {
      owner,
      otherPlayers,
      answerDeck,
    });
    const payload = extractGamePayload(result);

    if (payload?.gameId && payload.gameKey) {
      writeDevGameCache(devWindow, {
        gameId: payload.gameId,
        gameKey: payload.gameKey,
        playerId: resolvedPlayerId,
      });
      // Send tool-input notification so the App knows the player ID
      sendDevNotification("ui/notifications/tool-input", {
        arguments: { owner, otherPlayers, answerDeck },
      });
      // Send tool-result notification with game state
      sendDevNotification("ui/notifications/tool-result", { ...(result ?? { content: [] }) });
    }
  } catch (error) {
    console.warn("Dev helper failed to start game", error);
  }
}

function sendDevNotification(method: string, params: Record<string, unknown>): void {
  window.postMessage(
    {
      jsonrpc: "2.0",
      method,
      params,
    } satisfies JsonRpcRequest,
    "*",
  );
}
