import {
  type CSSProperties,
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  getAnswerCardById,
  useGameManagement,
  useGameState,
} from "./game-management";
import { Card, useCardManagement } from "./card-management";
import { AnswerCard as AnswerCardType, PromptCard as PromptCardType } from "./types";
import { useOpenAiGlobal } from "../use-openai-global";

type ResolvedCard =
  | {
      type: "answer";
      card: AnswerCardType;
    }
  | {
      type: "prompt";
      card: PromptCardType;
    };

interface PlayerToast {
  id: string;
  playerId: string;
  message: string;
  variant: "comment" | "judgement";
}

interface DialogToastEntry {
  key: string;
  toast: Omit<PlayerToast, "id">;
}

const TOAST_DURATION_MS = 8000;
const CARD_HEIGHT = 220;
const TOAST_STACK_OFFSET = 45;

function resolveCardById(gameState: ReturnType<typeof useGameState>, cardId: string): ResolvedCard | null {
  if (gameState.prompt?.id === cardId) {
    return { type: "prompt", card: gameState.prompt };
  }
  for (const promptCard of gameState.discardedPromptCards) {
    if (promptCard.id === cardId) {
      return { type: "prompt", card: promptCard };
    }
  }
  const answerCard = gameState.answerCards[cardId];
  if (answerCard) {
    return { type: "answer", card: answerCard };
  }
  return null;
}

export function CardsAgainstAiGame() {
  const [hasStarted, setHasStarted] = useState(false);
  const [toasts, setToasts] = useState<PlayerToast[]>([]);
  const displayMode = useOpenAiGlobal("displayMode");
  const gameState = useGameState();
  const { localPlayerId, playAnswerCard, judgeAnswerCard } = useGameManagement();
  const { cards, layout } = useCardManagement();
  const nextToastIdRef = useRef(0);
  const seenToastKeysRef = useRef(new Set<string>());
  const toastTimersRef = useRef(new Map<string, number>());

  const enqueueToast = useCallback((toast: Omit<PlayerToast, "id">) => {
    const id = `toast-${nextToastIdRef.current}`;
    nextToastIdRef.current += 1;
    setToasts((current) => [...current, { ...toast, id }]);
    const timeoutId = window.setTimeout(() => {
      setToasts((current) => current.filter((entry) => entry.id !== id));
      toastTimersRef.current.delete(id);
    }, TOAST_DURATION_MS);
    toastTimersRef.current.set(id, timeoutId);
  }, []);

  useEffect(() => {
    return () => {
      for (const timeoutId of toastTimersRef.current.values()) {
        window.clearTimeout(timeoutId);
      }
      toastTimersRef.current.clear();
    };
  }, []);

  const cardIdsInPlay = useMemo(() => {
    const ids: string[] = [];
    if (gameState.prompt) {
      ids.push(gameState.prompt.id);
    }
    for (const played of gameState.playedAnswerCards) {
      ids.push(played.cardId);
    }
    for (const player of gameState.players) {
      for (const cardId of player.answerCards) {
        ids.push(cardId);
      }
    }
    return ids;
  }, [gameState.playedAnswerCards, gameState.players, gameState.prompt]);

  const cardIdsInPlaySet = useMemo(() => new Set(cardIdsInPlay), [cardIdsInPlay]);

  const exitingCardIds = useMemo(() => {
    const ids: string[] = [];
    for (const cardId of cards.keys()) {
      if (!cardIdsInPlaySet.has(cardId)) {
        ids.push(cardId);
      }
    }
    return ids;
  }, [cards, cardIdsInPlaySet]);

  const hasCardLayout = useMemo(() => {
    if (cardIdsInPlay.length === 0) {
      return true;
    }
    for (const cardId of cardIdsInPlay) {
      if (!cards.has(cardId)) {
        return false;
      }
    }
    return true;
  }, [cardIdsInPlay, cards]);
  const localPlayer = useMemo(() => {
    if (!gameState.players.length) {
      return null;
    }
    if (localPlayerId) {
      return (
        gameState.players.find((player) => player.id === localPlayerId) ?? null
      );
    }
    return gameState.players[0];
  }, [gameState.players, localPlayerId]);

  const dialogToasts = useMemo(() => {
    const entries: DialogToastEntry[] = [];

    for (const played of gameState.playedAnswerCards) {
      if (!played.playerComment) {
        continue;
      }
      entries.push({
        key: `comment:${played.playerId}:${played.cardId}`,
        toast: {
          playerId: played.playerId,
          message: played.playerComment,
          variant: "comment",
        },
      });
    }

    const judgement = gameState.judgementResult;
    if (judgement?.reactionToWinningCard) {
      entries.push({
        key: `judge:${judgement.judgeId}:${judgement.winningCardId}:${judgement.reactionToWinningCard}`,
        toast: {
          playerId: judgement.judgeId,
          message: judgement.reactionToWinningCard,
          variant: "judgement",
        },
      });
    }

    const roundKey = judgement?.winningCardId ?? "unknown-round";
    for (const reaction of gameState.outcomeReactions) {
      if (!reaction.reaction) {
        continue;
      }
      entries.push({
        key: `outcome:${roundKey}:${reaction.playerId}:${reaction.reaction}`,
        toast: {
          playerId: reaction.playerId,
          message: reaction.reaction,
          variant: "comment",
        },
      });
    }

    return entries;
  }, [
    gameState.judgementResult,
    gameState.outcomeReactions,
    gameState.playedAnswerCards,
  ]);

  useEffect(() => {
    for (const entry of dialogToasts) {
      if (seenToastKeysRef.current.has(entry.key)) {
        continue;
      }
      seenToastKeysRef.current.add(entry.key);
      enqueueToast(entry.toast);
    }
  }, [dialogToasts, enqueueToast]);

  const toastsByPlayer = useMemo(() => {
    const grouped = new Map<string, PlayerToast[]>();
    for (const toast of toasts) {
      const existing = grouped.get(toast.playerId);
      if (existing) {
        existing.push(toast);
      } else {
        grouped.set(toast.playerId, [toast]);
      }
    }
    return grouped;
  }, [toasts]);

  if (!hasStarted) {
    return (
      <div className="flex h-full w-full items-center justify-center">
        <button
          type="button"
          className="rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-sm"
          onClick={() => {
            window?.openai?.requestDisplayMode?.({ mode: "fullscreen" });
            setHasStarted(true);
          }}
        >
          Start Game
        </button>
      </div>
    );
  }

  if (displayMode && displayMode !== "fullscreen") {
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-3 text-center text-sm text-slate-600">
        <div className="max-w-sm">
          This game continues in fullscreen. Use the widget composer so the game
          stays open.
        </div>
        <button
          type="button"
          className="rounded-full bg-slate-900 px-6 py-3 text-sm font-semibold text-white shadow-sm"
          onClick={() => {
            window?.openai?.requestDisplayMode?.({ mode: "fullscreen" });
          }}
        >
          Return to fullscreen
        </button>
      </div>
    );
  }

  const judgeName =
    gameState.players[gameState.currentJudgePlayerIndex]?.persona?.name ?? "TBD";
  const isLocalJudge =
    localPlayerId != null &&
    gameState.players[gameState.currentJudgePlayerIndex]?.id === localPlayerId;
  const canJudge = gameState.status === "judging" && isLocalJudge;
  const canPlayCard =
    gameState.status === "waiting-for-answers" &&
    localPlayer != null &&
    !isLocalJudge;
  const winningCardId = gameState.judgementResult?.winningCardId ?? null;

  return (
    <>
      {gameState.players.map((player, index) => {
        const panel = layout.playerPanels[player.id];
        if (!panel) {
          return null;
        }
        const isLocalPlayer = localPlayerId
          ? player.id === localPlayerId
          : index === 0;
        const label = player.persona?.name ?? (isLocalPlayer ? "You" : "Vacant");
        const roleLabel = isLocalPlayer
          ? "You"
          : player.type === "cpu"
            ? "CPU"
            : player.type === "vacant"
              ? "Vacant"
              : "Human";
        const winsCount = player.wonPromptCards.length;
        const playerInfoStyle = {
          "--panel-x": `${panel.centerX}px`,
          "--panel-y": `${panel.topY - 24}px`,
        } as CSSProperties;
        const toastStackStyle = {
          "--panel-x": `${panel.centerX}px`,
          "--panel-y": `${panel.topY + CARD_HEIGHT + TOAST_STACK_OFFSET}px`,
          "--toast-duration": `${TOAST_DURATION_MS}ms`,
        } as CSSProperties;
        const playerToasts = toastsByPlayer.get(player.id) ?? [];
        return (
          <Fragment key={player.id}>
            <div
              className="cards-ai-info-panel pointer-events-none absolute z-20 flex flex-col items-center text-xs font-semibold text-slate-900 dark:text-slate-100"
              style={playerInfoStyle}
            >
              <span>{label}</span>
              {!isLocalPlayer && (
                <span className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-300">
                  {roleLabel}
                </span>
              )}
              <span className="text-[10px] font-medium text-slate-600 dark:text-slate-300">
                Wins {winsCount}
              </span>
            </div>
            {playerToasts.length > 0 && (
              <div
                className="cards-ai-toast-stack pointer-events-none absolute z-20 flex flex-col items-center gap-2"
                style={toastStackStyle}
              >
                {playerToasts.map((toast) => (
                  <div
                    key={toast.id}
                    className="cards-ai-toast-bubble max-w-[240px] bg-slate-900/90 px-3.5 py-2 text-center text-[11px] font-medium leading-[1.35] text-slate-50 shadow-[0_10px_20px_-12px_rgba(15,23,42,0.7)] dark:bg-slate-800/90 dark:text-slate-200"
                    style={{
                      animation:
                        "cards-ai-toast-lifecycle var(--toast-duration, 8000ms) ease-in-out forwards",
                    }}
                  >
                    {toast.message}
                  </div>
                ))}
              </div>
            )}
          </Fragment>
        );
      })}

      {!localPlayerId && (
        <div className="absolute inset-0 z-10 flex items-center justify-center text-sm text-slate-500">
          Waiting for local player...
        </div>
      )}

      {gameState.status === "waiting-for-players" && (
        <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-500">
          Waiting for players...
        </div>
      )}

      {hasCardLayout && gameState.prompt && <PromptCard card={gameState.prompt} />}

      {hasCardLayout &&
        gameState.playedAnswerCards.map((played) => {
          const card = getAnswerCardById(gameState, played.cardId);
          const handleClick =
            canJudge && localPlayer
              ? () => judgeAnswerCard(played.cardId, localPlayer)
              : undefined;
          return (
            <AnswerCard
              key={played.cardId}
              card={card}
              onClick={handleClick}
              isWinner={winningCardId === played.cardId}
            />
          );
        })}

      {hasCardLayout &&
        gameState.players
          .flatMap((player) => player.answerCards)
          .map((cardId) => {
            const card = getAnswerCardById(gameState, cardId);
            const isLocalCard =
              canPlayCard && localPlayer.answerCards.includes(cardId);
            const handleClick = isLocalCard
              ? () => playAnswerCard(cardId, localPlayer)
              : undefined;
            return (
              <AnswerCard
                key={cardId}
                card={card}
                onClick={handleClick}
                isWinner={winningCardId === cardId}
              />
            );
          })}

      {hasCardLayout &&
        exitingCardIds.map((cardId) => {
          const resolvedCard = resolveCardById(gameState, cardId);
          if (!resolvedCard) {
            return null;
          }
          if (resolvedCard.type === "prompt") {
            return <PromptCard key={cardId} card={resolvedCard.card} />;
          }
          return (
            <AnswerCard
              key={cardId}
              card={resolvedCard.card}
              isWinner={winningCardId === cardId}
            />
          );
        })}

      {gameState.players.length > 0 && (
        <div className="absolute bottom-4 right-4 flex flex-col items-end gap-2">
          {import.meta.env.DEV && (
            <DevGameStatePanel gameState={gameState} />
          )}
          <div className="rounded-full bg-slate-900/80 px-3 py-1 text-xs font-semibold text-white">
            Judge: {judgeName}
          </div>
        </div>
      )}
    </>
  );
}

function AnswerCard({
  card,
  onClick,
  isWinner,
}: {
  card: AnswerCardType;
  onClick?: () => void;
  isWinner?: boolean;
}) {
  return (
    <Card id={card.id} onClick={onClick} isWinner={isWinner}>
      {card.text}
    </Card>
  );
}

function PromptCard({ card }: { card: PromptCardType }) {
  return (
    <Card id={card.id} invertColors>
      {card.text}
    </Card>
  );
}

function DevGameStatePanel({ gameState }: { gameState: ReturnType<typeof useGameState> }) {
  const [isOpen, setIsOpen] = useState(true);
  const toggleLabel = isOpen ? "Hide" : "Show";
  const panelId = "cards-ai-dev-panel";

  return (
    <div className="max-w-sm rounded-2xl border border-slate-800 bg-black/80 p-2 text-[11px] text-slate-100 shadow-sm">
      <div className="flex flex-wrap items-center gap-2 text-slate-200">
        <span>Status: {gameState.status}</span>
        <span>Players: {gameState.players.length}</span>
        <span>Played: {gameState.playedAnswerCards.length}</span>
        <button
          type="button"
          className="ml-auto rounded-full border border-slate-700 px-2 py-0.5 text-[10px] font-semibold text-slate-100 hover:border-slate-500 hover:text-white"
          aria-expanded={isOpen}
          aria-controls={panelId}
          onClick={() => setIsOpen((current) => !current)}
        >
          {toggleLabel}
        </button>
      </div>
      {isOpen && (
        <div id={panelId} className="mt-2">
          <div className="text-xs font-semibold text-slate-100">Game state</div>
          <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap rounded-lg p-2 text-[10px] text-slate-100">
            {JSON.stringify(gameState, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}
