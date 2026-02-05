import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  AnswerCard,
  GameState,
  NextActionHint,
  Player,
} from "./types";
import { useMcpApp, type ToolResultData } from "./McpAppProvider";

export function getAnswerCardById(state: GameState, cardId: string): AnswerCard | null {
  return state.answerCards[cardId] ?? null;
}

export interface GameManager {
  gameState: GameState;
  localPlayerId: string | null;
  playAnswerCard(cardId: string, player: Player): Promise<void>;
  judgeAnswerCard(cardId: string, judge: Player): Promise<void>;
}

export const GameManagementContext = createContext<GameManager | null>(null);

interface GameManagementProviderProps {
  children: React.ReactNode;
  gameId: string | null;
  gameKey: string | null;
  localPlayerId: string | null;
  serverGameState: GameState | null;
}

const createInitialGameState = (gameKey: string | null): GameState => ({
  gameKey: gameKey ?? "",
  prompt: null,
  playedAnswerCards: [],
  players: [],
  status: "waiting-for-players",
  winnerId: null,
  currentJudgePlayerIndex: 0,
  answerCards: {},
  answerDeck: [],
  discardedAnswerCards: [],
  discardedPromptCards: [],
  judgementResult: null,
});

/** Actions where the LLM must act — widget watches for state changes. */
const LLM_DEPENDENT_ACTIONS = new Set([
  "submit-cpu-answers",
  "submit-cpu-judgement",
  "submit-prompt",
]);

/** Widget-side timeout for watch-game-state calls (above the server's 45s hold). */
const WATCH_TOOL_TIMEOUT_MS = 55_000;

function isLlmDependentAction(nextAction: NextActionHint): boolean {
  return nextAction != null && LLM_DEPENDENT_ACTIONS.has(nextAction.action);
}

/**
 * Extract ToolResultData from a callServerTool result.
 * Returns null if the result is an error or has no structuredContent.
 */
function extractToolResultData(
  result: Awaited<ReturnType<NonNullable<ReturnType<typeof useMcpApp>["app"]>["callServerTool"]>>,
): ToolResultData | null {
  if (!result || result.isError) return null;
  return (result.structuredContent as ToolResultData | undefined) ?? null;
}

export function GameManagementProvider({
  children,
  gameId,
  gameKey,
  localPlayerId,
  serverGameState,
}: GameManagementProviderProps) {
  const { app, updateToolResultData } = useMcpApp();
  const gameIdRef = useRef(gameId);
  gameIdRef.current = gameId;

  const serverGameStateRef = useRef(serverGameState);
  serverGameStateRef.current = serverGameState;

  // Derive server state synchronously
  const resolvedServerState = useMemo(
    () => serverGameState ?? createInitialGameState(gameKey),
    [serverGameState, gameKey],
  );

  // Local override for optimistic updates.
  // Tagged with the serverGameState it was derived from — automatically
  // becomes stale when a new server state arrives via the prop.
  // NOTE: `basedOn` uses reference equality. This works because
  // `serverGameState` only changes identity on new tool responses.
  const [localOverride, setLocalOverride] = useState<{
    state: GameState;
    basedOn: GameState | null;
  } | null>(null);

  const gameState =
    localOverride && localOverride.basedOn === serverGameState
      ? localOverride.state
      : resolvedServerState;

  // Ref to track active watch so we can cancel it on unmount or new action
  const watchAbortRef = useRef<AbortController | null>(null);

  // Cleanup watch on unmount
  useEffect(() => {
    return () => {
      watchAbortRef.current?.abort();
    };
  }, []);

  /**
   * Long-poll `watch-game-state` — the server holds the response until state
   * changes or a ~45s timeout elapses. On timeout the widget retries immediately.
   * On change it updates state and continues watching if still LLM-dependent.
   */
  const watchForStateChange = useCallback(
    async (knownStatus: string, signal: AbortSignal) => {
      if (!app) return;
      const currentGameId = gameIdRef.current;
      if (!currentGameId) return;

      while (!signal.aborted) {
        try {
          const result = await app.callServerTool(
            {
              name: "watch-game-state",
              arguments: { gameId: currentGameId, knownStatus },
            },
            { timeout: WATCH_TOOL_TIMEOUT_MS },
          );

          if (signal.aborted) return;

          const data = extractToolResultData(result);
          if (!data) continue;

          const responseType = (data as { type?: string }).type;

          if (responseType === "timeout") {
            // Server timed out with no change — retry immediately
            continue;
          }

          // State changed — push update
          if (data.gameState) {
            setLocalOverride(null);
            updateToolResultData(data);

            // If still LLM-dependent, keep watching with new baseline
            const nextAction = (data as { nextAction?: NextActionHint }).nextAction ?? null;
            if (nextAction && isLlmDependentAction(nextAction)) {
              knownStatus = data.gameState.status;
              continue;
            }
          }

          return; // Done — human turn or game over
        } catch (err) {
          if (signal.aborted) return;
          console.warn("[cards-ai] watch-game-state failed, retrying", err);
          // Brief pause before retry on error
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    },
    [app, updateToolResultData],
  );

  /**
   * After a human action, apply the server response and start watching if
   * the next action is LLM-dependent.
   */
  const handleServerResponse = useCallback(
    (data: ToolResultData) => {
      // Clear optimistic override — we have real server state
      setLocalOverride(null);
      updateToolResultData(data);

      const nextAction = (data as { nextAction?: NextActionHint }).nextAction ?? null;

      // Always send a message to nudge the LLM if the next step is LLM-dependent
      if (nextAction && isLlmDependentAction(nextAction)) {
        const actionMessages: Record<string, string> = {
          "submit-cpu-answers": "I played my answer card. Continue with the next game action.",
          "submit-cpu-judgement": "All cards are played. The CPU judge should pick a winner now.",
          "submit-prompt": "Round complete. Continue with the next prompt.",
        };
        const messageText = actionMessages[nextAction.action]
          ?? "Continue with the next game action.";

        app?.sendMessage({
          role: "user",
          content: [{ type: "text", text: messageText }],
        }).catch((err: unknown) => {
          console.warn("[cards-ai] sendMessage failed", err);
        });

        // Cancel any existing watch and start fresh
        watchAbortRef.current?.abort();
        const abort = new AbortController();
        watchAbortRef.current = abort;

        const snapshotStatus = data.gameState?.status ?? "";
        watchForStateChange(snapshotStatus, abort.signal).catch((err) => {
          console.warn("[cards-ai] watchForStateChange error", err);
        });
      }
    },
    [app, updateToolResultData, watchForStateChange],
  );

  const playAnswerCard = useCallback(
    async (cardId: string, player: Player) => {
      const currentGameId = gameIdRef.current;
      if (!currentGameId) {
        console.warn("[cards-ai] no gameId for playAnswerCard");
        return;
      }

      // Optimistic local update
      setLocalOverride((prev) => {
        const snapshot = serverGameStateRef.current;
        const base =
          prev && prev.basedOn === snapshot
            ? prev.state
            : (snapshot ?? createInitialGameState(null));
        if (base.status !== "waiting-for-answers") return prev;
        if (base.playedAnswerCards.some((p) => p.playerId === player.id))
          return prev;
        return {
          state: {
            ...base,
            playedAnswerCards: [
              ...base.playedAnswerCards,
              { cardId, playerId: player.id },
            ],
            players: base.players.map((p) =>
              p.id === player.id
                ? {
                    ...p,
                    answerCards: p.answerCards.filter((id) => id !== cardId),
                  }
                : p,
            ),
          },
          basedOn: snapshot,
        };
      });

      try {
        if (!app) {
          console.warn("[cards-ai] MCP app not available");
          setLocalOverride(null);
          return;
        }
        const result = await app.callServerTool({
          name: "play-answer-card",
          arguments: {
            gameId: currentGameId,
            playerId: player.id,
            cardId,
          },
        });

        const data = extractToolResultData(result);
        if (data) {
          handleServerResponse(data);
        }
      } catch (error) {
        console.error("[cards-ai] failed to play answer card", error);
        setLocalOverride(null); // Roll back optimistic update
      }
    },
    [app, handleServerResponse],
  );

  const judgeAnswerCard = useCallback(
    async (cardId: string, judge: Player) => {
      const currentGameId = gameIdRef.current;
      if (!currentGameId) {
        console.warn("[cards-ai] no gameId for judgeAnswerCard");
        return;
      }

      // Optimistic local update
      setLocalOverride((prev) => {
        const snapshot = serverGameStateRef.current;
        const base =
          prev && prev.basedOn === snapshot
            ? prev.state
            : (snapshot ?? createInitialGameState(null));
        if (base.status !== "judging") return prev;
        const played = base.playedAnswerCards.find((p) => p.cardId === cardId);
        if (!played) return prev;
        return {
          state: {
            ...base,
            status: "display-judgement",
            judgementResult: {
              judgeId: judge.id,
              winningCardId: cardId,
              winningPlayerId: played.playerId,
            },
          },
          basedOn: snapshot,
        };
      });

      try {
        if (!app) {
          console.warn("[cards-ai] MCP app not available");
          setLocalOverride(null);
          return;
        }
        const result = await app.callServerTool({
          name: "judge-answer-card",
          arguments: {
            gameId: currentGameId,
            playerId: judge.id,
            winningCardId: cardId,
          },
        });

        const data = extractToolResultData(result);
        if (data) {
          handleServerResponse(data);
        }
      } catch (error) {
        console.error("[cards-ai] failed to submit judgement", error);
        setLocalOverride(null); // Roll back optimistic update
      }
    },
    [app, handleServerResponse],
  );

  const gameManager = useMemo(
    () => ({
      gameState,
      localPlayerId,
      playAnswerCard,
      judgeAnswerCard,
    }),
    [
      gameState,
      localPlayerId,
      playAnswerCard,
      judgeAnswerCard,
    ],
  );

  return (
    <GameManagementContext.Provider value={gameManager}>
      {children}
    </GameManagementContext.Provider>
  );
}

export function useGameManagement() {
  const gameManager = useContext(GameManagementContext);

  if (!gameManager) {
    throw new Error("GameManagementContext not found");
  }

  return gameManager;
}

export function useGameState() {
  const gameManager = useGameManagement();

  return gameManager.gameState;
}
