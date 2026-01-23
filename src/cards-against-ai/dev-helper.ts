import { createFakeAnswerDeck } from "./fetchAnswerDeck";
import { createFakePlayers } from "./fetchPlayers";

interface DevGameCache {
  gameId: string;
  gameKey: string;
  playerId: string;
}

interface PendingRequest {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

interface McpState {
  endpointUrl: string | null;
  eventSource: EventSource | null;
  nextId: number;
  pending: Map<number, PendingRequest>;
  initPromise: Promise<void> | null;
}

interface CardsAgainstAiToolResult {
  structuredContent?: {
    gameId?: string;
    gameKey?: string;
  };
  _meta?: {
    gameId?: string;
    gameKey?: string;
  };
}

interface DevWindow extends Window {
  __cardsAgainstAiDevInit?: boolean;
  __cardsAgainstAiMcpState?: McpState;
}

const DEV_GAME_CACHE_KEY = "cards-against-ai-dev-game";
const DEFAULT_PLAYER_ID = "player-001";
const MCP_URL = "http://localhost:8000/mcp";

function extractGamePayload(
  result: unknown,
): { gameId?: string; gameKey?: string } | null {
  if (!result || typeof result !== "object") {
    return null;
  }

  const typed = result as CardsAgainstAiToolResult;
  if (typed.structuredContent?.gameId && typed.structuredContent?.gameKey) {
    return typed.structuredContent;
  }

  if (typed._meta?.gameId && typed._meta?.gameKey) {
    return typed._meta;
  }

  return null;
}
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

function dispatchGlobals(globals: Record<string, unknown>): void {
  window.dispatchEvent(
    new CustomEvent("openai:set_globals", { detail: { globals } }),
  );
}

function ensureMcpState(devWindow: DevWindow): McpState {
  devWindow.__cardsAgainstAiMcpState ??= {
    endpointUrl: null,
    eventSource: null,
    nextId: 1,
    pending: new Map(),
    initPromise: null,
  };

  return devWindow.__cardsAgainstAiMcpState;
}

async function postMcpMessage(
  endpointUrl: string,
  payload: Record<string, unknown>,
): Promise<void> {
  await fetch(endpointUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
}

async function connectMcp(state: McpState): Promise<void> {
  if (state.initPromise) {
    return state.initPromise;
  }

  state.initPromise = new Promise<void>((resolve, reject) => {
    const eventSource = new EventSource(MCP_URL);
    state.eventSource = eventSource;

    eventSource.addEventListener("endpoint", (event) => {
      const data = (event as MessageEvent<string>).data;
      state.endpointUrl = new URL(data, MCP_URL).toString();
      resolve();
    });

    eventSource.addEventListener("message", (event) => {
      const data = (event as MessageEvent<string>).data;
      if (!data) {
        return;
      }
      try {
        const parsed = JSON.parse(data) as {
          id?: number;
          result?: unknown;
          error?: { message?: string };
        };
        if (typeof parsed.id !== "number") {
          return;
        }
        const pending = state.pending.get(parsed.id);
        if (!pending) {
          return;
        }
        state.pending.delete(parsed.id);
        if (parsed.error) {
          pending.reject(
            new Error(parsed.error.message ?? "MCP request failed"),
          );
          return;
        }
        pending.resolve(parsed.result);
      } catch (error) {
        console.warn("Failed to parse MCP message", error);
      }
    });

    eventSource.addEventListener("error", () => {
      reject(new Error("Failed to connect to MCP server"));
    });
  });

  await state.initPromise;

  if (!state.endpointUrl) {
    throw new Error("MCP endpoint URL missing");
  }

  const initPayload = {
    jsonrpc: "2.0",
    id: state.nextId++,
    method: "initialize",
    params: {
      protocolVersion: "2024-11-05",
      clientInfo: { name: "cards-ai-dev", version: "0.0.0" },
      capabilities: {},
    },
  };

  const initPromise = new Promise<void>((resolve, reject) => {
    state.pending.set(initPayload.id, {
      resolve: () => resolve(),
      reject,
    });
  });

  await postMcpMessage(state.endpointUrl, initPayload);
  await initPromise;

  await postMcpMessage(state.endpointUrl, {
    jsonrpc: "2.0",
    method: "notifications/initialized",
  });
}

async function callLocalMcpTool(
  devWindow: DevWindow,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const state = ensureMcpState(devWindow);
  await connectMcp(state);

  if (!state.endpointUrl) {
    throw new Error("MCP endpoint URL missing");
  }

  const requestId = state.nextId++;
  const responsePromise = new Promise<unknown>((resolve, reject) => {
    state.pending.set(requestId, { resolve, reject });
  });

  await postMcpMessage(state.endpointUrl, {
    jsonrpc: "2.0",
    id: requestId,
    method: "tools/call",
    params: {
      name,
      arguments: args,
    },
  });

  return responsePromise;
}

export async function initCardsAgainstAiDevHelper(): Promise<void> {
  if (typeof window === "undefined") {
    return;
  }

  const devWindow = window as DevWindow;

  devWindow.__APP_URL_CONFIG__ ??= {
    apiBaseUrl: "http://localhost:8000",
    assetsBaseUrl: "http://localhost:4444",
  };

  const devSearchParams = new URLSearchParams(devWindow.location.search);
  const devGameId = devSearchParams.get("gameId")?.trim() || null;
  const devGameKey = devSearchParams.get("gameKey")?.trim() || null;
  const devPlayerParam = devSearchParams.get("playerId")?.trim() || null;
  const cachedGame = readDevGameCache(devWindow);

  const openAiGlobals = (devWindow.openai ??= {} as Window["openai"]);
  const initialGameId = devGameId ?? null;
  const initialGameKey = devGameKey ?? null;
  const resolvedPlayerId =
    devPlayerParam ?? cachedGame?.playerId ?? DEFAULT_PLAYER_ID;

  openAiGlobals.toolOutput ??= {};
  openAiGlobals.toolInput ??= {
    owner: { id: resolvedPlayerId },
    player: { id: resolvedPlayerId },
  };
  openAiGlobals.displayMode ??= "fullscreen";
  openAiGlobals.setWidgetState ??= async () => {};
  openAiGlobals.toolResponseMetadata ??= {
    ...(initialGameId ? { gameId: initialGameId } : {}),
    ...(initialGameKey ? { gameKey: initialGameKey } : {}),
  };
  openAiGlobals.widgetState ??= null;
  openAiGlobals.callTool ??= async (name, args) =>
    (await callLocalMcpTool(devWindow, name, args)) as unknown as {
      result: string;
    };
  if (devWindow.__cardsAgainstAiDevInit) {
    return;
  }

  devWindow.__cardsAgainstAiDevInit = true;

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
        const joinResult = await callLocalMcpTool(devWindow, "join-game", {
          gameKey: joinGameKey,
          player: owner,
        });
        const joinPayload = extractGamePayload(joinResult);

        if (joinPayload?.gameId && joinPayload.gameKey) {
          openAiGlobals.toolResponseMetadata = {
            gameId: joinPayload.gameId,
            gameKey: joinPayload.gameKey,
          };
          dispatchGlobals({
            toolResponseMetadata: openAiGlobals.toolResponseMetadata,
          });
          writeDevGameCache(devWindow, {
            gameId: joinPayload.gameId,
            gameKey: joinPayload.gameKey,
            playerId: resolvedPlayerId,
          });
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
    const result = await callLocalMcpTool(devWindow, "start-game", {
      owner,
      otherPlayers,
      answerDeck,
    });
    const payload = extractGamePayload(result);

    if (!payload?.gameId || !payload.gameKey) {
      return;
    }

    openAiGlobals.toolResponseMetadata = {
      gameId: payload.gameId,
      gameKey: payload.gameKey,
    };
    dispatchGlobals({
      toolResponseMetadata: openAiGlobals.toolResponseMetadata,
    });

    writeDevGameCache(devWindow, {
      gameId: payload.gameId,
      gameKey: payload.gameKey,
      playerId: resolvedPlayerId,
    });
  } catch (error) {
    console.warn("Dev helper failed to start game", error);
  }
}
