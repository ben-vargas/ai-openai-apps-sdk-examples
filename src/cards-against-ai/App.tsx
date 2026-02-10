import { useCallback, useEffect, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App as McpApp } from "@modelcontextprotocol/ext-apps/react";
import { PlayArea } from "./PlayArea";
import { SplashScreen } from "./SplashScreen";
import type { GameState } from "./types";

/** Widget-side timeout for watch-game-state calls (above the server's 45s hold). */
const WATCH_TOOL_TIMEOUT_MS = 55_000;

function useWatchGameState(
  app: McpApp | null,
  gameId: string | null,
  gameState: GameState | null,
  setGameState: Dispatch<SetStateAction<GameState | null>>,
) {
  const gameStateRef = useRef(gameState);
  gameStateRef.current = gameState;

  useEffect(() => {
    if (!app || !gameState || !gameId) return;

    const abort = new AbortController();
    const { signal } = abort;

    (async () => {
      let knownStatus = gameStateRef.current?.status ?? "";

      while (!signal.aborted) {
        try {
          const result = await app.callServerTool(
            {
              name: "watch-game-state",
              arguments: { gameId, knownStatus },
            },
            { timeout: WATCH_TOOL_TIMEOUT_MS },
          );

          if (signal.aborted) return;

          const sc = result?.structuredContent as
            | { type?: string; gameState?: GameState }
            | undefined;
          if (!sc) continue;

          if (sc.type === "timeout") {
            // Server timed out with no change — retry immediately
            continue;
          }

          // State changed — update
          if (sc.gameState) {
            setGameState(sc.gameState);
            knownStatus = sc.gameState.status;
            continue;
          }

          return; // Unexpected shape — stop polling
        } catch (err) {
          if (signal.aborted) return;
          console.warn("[cards-ai] watch-game-state failed, retrying", err);
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    })();

    return () => abort.abort();
  }, [app, !!gameState, gameId]); // eslint-disable-line react-hooks/exhaustive-deps
}

function useCardsAgainstAIGame() {
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [gameId, setGameId] = useState<string | null>(null);

  const onAppCreated = useCallback((app: McpApp) => {
    app.ontoolresult = (params) => {
      const sc = params.structuredContent as
        | { gameState?: GameState; gameId?: string }
        | undefined;
      if (sc?.gameState) {
        setGameState(sc.gameState);
      }
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

  useWatchGameState(app, gameId, gameState, setGameState);

  return { gameState, app } as const;
}

export default function App() {
  const { gameState, app } = useCardsAgainstAIGame();
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

  return <PlayArea gameState={gameState} />;
}
