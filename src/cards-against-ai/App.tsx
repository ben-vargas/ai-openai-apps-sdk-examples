import { useEffect, useMemo, useRef } from "react";
import { GameManagementContext, GameManagementProvider } from "./game-management";
import { CardsAgainstAiGame } from "./CardsAgainstAiGame";
import { McpAppProvider, useMcpApp } from "./McpAppProvider";
import { DEV_SCENARIO_NAMES, getDevScenario } from "./dev-scenarios";
import type { GameManager } from "./game-management";

interface PlayerIdPayload {
  id?: string;
}

if (import.meta.env.DEV) {
  void import("./dev-helper").then((module) =>
    module.initCardsAgainstAiDevHelper(),
  );
}

const DEV_SCENARIO_PARAM = import.meta.env.DEV
  ? new URLSearchParams(window.location.search).get("dev")
  : null;

export default function App() {
  if (DEV_SCENARIO_PARAM) {
    return <DevScenarioApp scenario={DEV_SCENARIO_PARAM} />;
  }

  return (
    <McpAppProvider>
      <ProductionApp />
    </McpAppProvider>
  );
}

function ProductionApp() {
  const { toolResultData, toolInput } = useMcpApp();
  const lastToolInputSignatureRef = useRef<string | null>(null);
  const lastToolResultDataSignatureRef = useRef<string | null>(null);

  // Extract localPlayerId from tool input and persist it — subsequent
  // host-initiated tool calls (e.g. submit-cpu-answers) have different
  // argument shapes that don't contain a player id.
  const localPlayerIdRef = useRef<string | null>(null);
  const localPlayerId = useMemo(() => {
    if (toolInput) {
      // join-game path: toolInput.player.id
      const player = toolInput.player as PlayerIdPayload | undefined;
      if (player?.id) {
        localPlayerIdRef.current = player.id;
        return player.id;
      }

      // start-game path: find human player in players array
      const players = toolInput.players as Array<{ id?: string; type?: string }> | undefined;
      if (Array.isArray(players)) {
        const human = players.find((p) => p.type === "human");
        if (human?.id) {
          localPlayerIdRef.current = human.id;
          return human.id;
        }
      }
    }

    return localPlayerIdRef.current;
  }, [toolInput]);

  useEffect(() => {
    const signature = JSON.stringify(toolInput);
    if (signature === lastToolInputSignatureRef.current) {
      return;
    }
    lastToolInputSignatureRef.current = signature;
    if (toolInput) {
      console.info("[cards-ai] tool input", toolInput);
    }
  }, [toolInput]);

  useEffect(() => {
    const signature = JSON.stringify(toolResultData);
    if (signature === lastToolResultDataSignatureRef.current) {
      return;
    }
    lastToolResultDataSignatureRef.current = signature;
    if (toolResultData) {
      console.info("[cards-ai] tool result data", toolResultData);
    }
  }, [toolResultData]);

  const resolvedGameId = toolResultData?.gameId ?? null;
  const resolvedGameKey = toolResultData?.gameKey ?? null;
  const serverGameState = toolResultData?.gameState ?? null;

  return (
    <div className="h-screen w-screen overflow-auto bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <GameManagementProvider
        gameId={resolvedGameId}
        gameKey={resolvedGameKey}
        localPlayerId={localPlayerId}
        serverGameState={serverGameState}
      >
        <CardsAgainstAiGame />
      </GameManagementProvider>
    </div>
  );
}

function DevScenarioApp({ scenario }: { scenario: string }) {
  const gameState = useMemo(() => getDevScenario(scenario), [scenario]);

  const mockManager = useMemo<GameManager | null>(() => {
    if (!gameState) return null;
    return {
      gameState,
      localPlayerId: "player-001",
      playAnswerCard: async () => {
        console.info("[dev] playAnswerCard called");
      },
      judgeAnswerCard: async () => {
        console.info("[dev] judgeAnswerCard called");
      },
    };
  }, [gameState]);

  if (!mockManager) {
    return (
      <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
        <div className="text-lg font-bold">
          Unknown dev scenario: &quot;{scenario}&quot;
        </div>
        <div className="text-sm text-slate-500">Available scenarios:</div>
        <div className="flex flex-wrap gap-2">
          {DEV_SCENARIO_NAMES.map((name) => (
            <a
              key={name}
              href={`?dev=${name}`}
              className="rounded-lg bg-slate-200 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-300 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700"
            >
              {name}
            </a>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen overflow-auto bg-slate-50 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <GameManagementContext.Provider value={mockManager}>
        <CardsAgainstAiGame />
      </GameManagementContext.Provider>
    </div>
  );
}
