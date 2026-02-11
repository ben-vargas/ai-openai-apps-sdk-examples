import { useCallback, useEffect, useState } from "react";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App as McpApp } from "@modelcontextprotocol/ext-apps/react";
import { PlayArea } from "./PlayArea";
import { SplashScreen } from "./SplashScreen";
import type { GameState } from "./types";

/** Widget-side timeout for watch-game-state calls (above the server's 45s hold). */
const WATCH_TOOL_TIMEOUT_MS = 55_000;

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

  // Watch loop — plain long-poll effect, no pause/restart coordination needed.
  // Concurrent callServerTool/sendMessage calls are safe (unique messageIds),
  // and the watch server self-corrects via immediate notifyChange() resolution.
  useEffect(() => {
    if (!app || !gameId) return;
    const abort = new AbortController();

    (async () => {
      let knownStatus = "";
      while (!abort.signal.aborted) {
        try {
          const result = await app.callServerTool(
            {
              name: "watch-game-state",
              arguments: { gameId, knownStatus },
            },
            { timeout: WATCH_TOOL_TIMEOUT_MS },
          );

          if (abort.signal.aborted) return;

          const sc = result?.structuredContent as
            | { type?: string; gameState?: GameState }
            | undefined;
          if (!sc) continue;

          if (sc.type === "timeout") continue;

          if (sc.gameState) {
            setGameState(sc.gameState);
            knownStatus = sc.gameState.status;
            if (knownStatus === "announce-winner" || knownStatus === "game-ended") return;
            continue;
          }

          return; // Unexpected shape — stop polling
        } catch (err) {
          if (abort.signal.aborted) return;
          console.warn("[cards-ai] watch-game-state failed, retrying", err);
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    })();

    return () => abort.abort();
  }, [app, gameId]);

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
  <PlayArea app={app} gameId={gameId} gameState={gameState} />
  );
}
