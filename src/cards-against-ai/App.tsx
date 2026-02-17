import { useCallback, useEffect, useState } from "react";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App as McpApp } from "@modelcontextprotocol/ext-apps/react";
import { PlayArea } from "./PlayArea";
import { SplashScreen } from "./SplashScreen";
import { getApiBaseUrl } from "./api-base-url";
import type { GameState } from "./types";

/**
 * Wires up the two MCP Apps data channels:
 * 1. `ontoolresult` — fires on every tool response. We use it once to grab the
 *    gameId from `start-game`, which bootstraps the SSE connection.
 * 2. SSE (`useStreamingGameState`) — server pushes the full gameState on every
 *    change, so the widget stays in sync independent of its own actions.
 */
function useCardsAgainstAIGame() {
  const [gameId, setGameId] = useState<string | null>(null);

  const onAppCreated = useCallback((app: McpApp) => {
    // ontoolresult fires on every tool response the model makes.
    // We only care about the first one (start-game) to extract the gameId.
    // After that, SSE delivers all state updates.
    app.ontoolresult = (params) => {
      const sc = params.structuredContent as
        | { gameId?: string }
        | undefined;
      if (sc?.gameId) {
        setGameId(sc.gameId);
      }
    };
  }, []);

  // useApp() initializes the MCP Apps connection via postMessage/JSON-RPC.
  // `appInfo` identifies this widget to the host (ChatGPT).
  // `onAppCreated` runs once after the host handshake completes.
  const { app } = useApp({
    appInfo: { name: "cards-against-ai", version: "1.0.0" },
    capabilities: {},
    onAppCreated,
  });

  const gameState = useStreamingGameState(gameId);

  return { gameState, gameId, app } as const;
}

/**
 * SSE is used instead of tool responses for ongoing state because state changes
 * happen server-side (from other tool calls the model makes). The widget needs
 * real-time updates independent of its own actions — e.g. when the model plays
 * CPU answer cards, the widget must see the new state immediately.
 */
function useStreamingGameState(gameId: string | null) {
  const [gameState, setGameState] = useState<GameState | null>(null);

  // Open an EventSource to the server's custom SSE endpoint when gameId is set.
  useEffect(() => {
    if (!gameId) return;

    let cancelled = false;
    let es: EventSource | null = null;
    let reconnectTimeout: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (cancelled) return;
      const baseUrl = getApiBaseUrl();
      const url = `${baseUrl}/mcp/game/${gameId}/state-stream`;
       es = new EventSource(url);
  
      es.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as { gameState?: GameState };
          if (data.gameState) {
            setGameState(data.gameState);
          }
        } catch {
          console.warn("[cards-ai] SSE message parse error", event.data);
        }
      };
  
      es.onerror = () => {
        console.error("[cards-ai] SSE connection error (reconnecting...)");
        if (cancelled) return;
        // Reconnect after 5 seconds
        reconnectTimeout = setTimeout(connect, 5000);
      };
    }

    // Initialize the connection
    connect();

    return () => {
      cancelled = true;
      es?.close();
      if (reconnectTimeout) {
        clearTimeout(reconnectTimeout);
      }
    };
  }, [gameId]);

  return gameState;
}

export default function App() {
  const { gameState, gameId, app } = useCardsAgainstAIGame();
  const [pipStarted, setPipStarted] = useState(false);

  if (!pipStarted) {
    return (
      <SplashScreen
        status={gameState?.status ?? "initializing"}
        onStart={() => {
          // Request picture-in-picture mode so the widget stays visible
          // while the user continues chatting with the model.
          app?.requestDisplayMode({ mode: "pip" });
          setPipStarted(true);
        }}
      />
    );
  }

  if (!gameState) {
    return <div>Loading...</div>;
  }

  return (
    <PlayArea
      app={app}
      gameId={gameId}
      gameState={gameState}
    />
  );
}
