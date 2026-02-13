import { useCallback, useEffect, useState } from "react";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App as McpApp } from "@modelcontextprotocol/ext-apps/react";
import { PlayArea } from "./PlayArea";
import { SplashScreen } from "./SplashScreen";
import { getApiBaseUrl } from "./api-base-url";
import type { GameState } from "./types";

function useCardsAgainstAIGame() {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [gameId, setGameId] = useState<string | null>(null);

  const onAppCreated = useCallback((app: McpApp) => {
    // ontoolresult: only used to extract gameId from start-game
    app.ontoolresult = (params) => {
      const sc = params.structuredContent as
        | { gameId?: string }
        | undefined;
      if (sc?.gameId) {
        setGameId(sc.gameId);
      }
    };
  }, []);

  const { app } = useApp({
    appInfo: { name: "cards-against-ai", version: "1.0.0" },
    capabilities: {},
    onAppCreated,
  });

  // SSE: open EventSource when gameId is set
  useEffect(() => {
    if (!gameId) return;

    const baseUrl = getApiBaseUrl();
    const url = `${baseUrl}/mcp/game/${gameId}/state-stream`;
    const es = new EventSource(url);

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data) as { gameState?: GameState };
        if (data.gameState) {
          setGameState(data.gameState);
        }
      } catch {
        // Ignore parse errors
      }
    };

    es.onerror = () => {
      console.error("[cards-ai] SSE connection error");
    };

    return () => {
      es.close();
    };
  }, [gameId]);

  return { gameState, gameId, app } as const;
}

export default function App() {
  const { gameState, gameId, app } = useCardsAgainstAIGame();
  const [pipStarted, setPipStarted] = useState(false);

  if (!pipStarted) {
    return (
      <SplashScreen
        status={gameState?.status ?? "initializing"}
        onStart={() => {
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
