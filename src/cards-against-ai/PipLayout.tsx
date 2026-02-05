import { useCallback, useMemo, useState } from "react";
import {
  getAnswerCardById,
  useGameManagement,
  useGameState,
} from "./game-management";
import { AbsPipCard } from "./AbsPipCard";
import {
  PipCardManagementProvider,
  usePipCardManagement,
} from "./pip-card-management";
import { Scoreboard } from "./Scoreboard";
import { DEV_SCENARIO_NAMES } from "./dev-scenarios";
import type { GameState } from "./types";

export function PipLayout() {
  return (
    <div className="cards-ai-pip flex h-full flex-col">
      {import.meta.env.DEV && <DevScenarioBar />}
      <PipCardManagementProvider>
        <PipLayoutInner />
      </PipCardManagementProvider>
    </div>
  );
}

function PipLayoutInner() {
  const gameState = useGameState();
  const { localPlayerId, playAnswerCard, judgeAnswerCard } =
    useGameManagement();
  const { cards } = usePipCardManagement();

  const localPlayer = useMemo(() => {
    if (!gameState.players.length) return null;
    if (localPlayerId) {
      return (
        gameState.players.find((player) => player.id === localPlayerId) ?? null
      );
    }
    return gameState.players[0];
  }, [gameState.players, localPlayerId]);

  const isLocalJudge =
    localPlayerId != null &&
    gameState.players[gameState.currentJudgePlayerIndex]?.id === localPlayerId;
  const localPlayerHasPlayed = gameState.playedAnswerCards.some(
    (p) => p.playerId === localPlayerId,
  );
  const canJudge = gameState.status === "judging" && isLocalJudge;
  const canPlayCard =
    gameState.status === "waiting-for-answers" &&
    localPlayer != null &&
    !isLocalJudge;
  const winningCardId = gameState.judgementResult?.winningCardId ?? null;

  const handlePlayCard = useCallback(
    (cardId: string) => {
      if (canPlayCard && localPlayer) {
        playAnswerCard(cardId, localPlayer);
      }
    },
    [canPlayCard, localPlayer, playAnswerCard],
  );

  const handleJudgeCard = useCallback(
    (cardId: string) => {
      if (canJudge && localPlayer) {
        judgeAnswerCard(cardId, localPlayer);
      }
    },
    [canJudge, localPlayer, judgeAnswerCard],
  );

  if (!localPlayerId) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-slate-500">
        Waiting for local player...
      </div>
    );
  }

  if (gameState.status === "announce-winner") {
    const winner = gameState.players.find((p) => p.id === gameState.winnerId);
    const winnerName = winner?.persona?.name ?? "Unknown";
    const isLocalWinner = localPlayerId === gameState.winnerId;

    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 py-8">
        <div className="text-4xl">🏆</div>
        <div className="text-center">
          <div className="text-lg font-bold text-slate-800 dark:text-slate-100">
            {isLocalWinner ? "You Win!" : `${winnerName} Wins!`}
          </div>
          <div className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            First to 5 points!
          </div>
        </div>
        <Scoreboard
          players={gameState.players}
          currentJudgePlayerIndex={gameState.currentJudgePlayerIndex}
          localPlayerId={localPlayerId}
        />
      </div>
    );
  }

  // Status messages
  const showDealingMessage =
    gameState.status === "dealing" && cards.size === 0;
  const showJudgeWaitingForAnswers =
    gameState.status === "waiting-for-answers" && isLocalJudge;
  const showPlayerWaitingMessage =
    gameState.status === "waiting-for-answers" &&
    !isLocalJudge &&
    localPlayerHasPlayed;
  const showPickWinnerMessage =
    gameState.status === "judging" && isLocalJudge;
  const judgementWinner =
    gameState.status === "display-judgement" && gameState.judgementResult
      ? gameState.players.find(
          (p) => p.id === gameState.judgementResult?.winningPlayerId,
        )
      : null;

  return (
    <>
      {/* Scoreboard overlay */}
      <div className="absolute right-2 top-2 z-10">
        <Scoreboard
          players={gameState.players}
          currentJudgePlayerIndex={gameState.currentJudgePlayerIndex}
          localPlayerId={localPlayerId}
        />
      </div>

      {/* Prompt card */}
      {gameState.prompt && cards.has(gameState.prompt.id) && (
        <AbsPipCard id={gameState.prompt.id} invertColors>
          {gameState.prompt.text}
        </AbsPipCard>
      )}

      {/* Played/judged cards */}
      {gameState.playedAnswerCards.map((played) => {
        if (!cards.has(played.cardId)) return null;
        const card = gameState.answerCards[played.cardId];
        const isWinner = winningCardId === played.cardId;
        return (
          <AbsPipCard
            key={played.cardId}
            id={played.cardId}
            isWinner={isWinner}
            onClick={canJudge ? () => handleJudgeCard(played.cardId) : undefined}
          >
            {card?.text ?? "???"}
          </AbsPipCard>
        );
      })}

      {/* Local player hand cards */}
      {localPlayer &&
        gameState.status === "waiting-for-answers" &&
        !localPlayerHasPlayed &&
        !isLocalJudge &&
        localPlayer.answerCards.map((cardId) => {
          if (!cards.has(cardId)) return null;
          const card = getAnswerCardById(gameState, cardId);
          if (!card) return null;
          return (
            <AbsPipCard
              key={cardId}
              id={cardId}
              isHandCard
              onClick={
                canPlayCard ? () => handlePlayCard(cardId) : undefined
              }
            >
              {card.text}
            </AbsPipCard>
          );
        })}

      {/* Status overlays */}
      {showDealingMessage && (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-slate-500">
          Dealing cards...
        </div>
      )}

      {showJudgeWaitingForAnswers && (
        <div className="absolute bottom-4 left-0 right-0 text-center text-xs text-slate-500">
          You're the judge. Waiting for answers...
        </div>
      )}

      {showPlayerWaitingMessage && (
        <div className="absolute bottom-4 left-0 right-0 text-center text-xs text-slate-500">
          Waiting for other players...
        </div>
      )}

      {showPickWinnerMessage && (
        <div className="absolute bottom-4 left-0 right-0 text-center text-xs font-semibold text-slate-600 dark:text-slate-300">
          Pick the funniest card!
        </div>
      )}

      {judgementWinner && (
        <div className="absolute bottom-4 left-0 right-0 text-center text-xs font-semibold text-slate-600 dark:text-slate-300">
          {judgementWinner.id === localPlayerId
            ? "You won this round!"
            : `${judgementWinner.persona?.name ?? "Unknown"} wins!`}
        </div>
      )}

      {/* Dev panel in dev mode */}
      {import.meta.env.DEV && (
        <div className="absolute bottom-0 left-0 right-0 z-20">
          <DevPanel gameState={gameState} />
        </div>
      )}
    </>
  );
}

function DevScenarioBar() {
  const currentScenario = new URLSearchParams(window.location.search).get(
    "dev",
  );
  return (
    <div className="flex items-center gap-1.5 border-b border-slate-200 px-3 py-1 dark:border-slate-700">
      <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400">
        Dev
      </span>
      {DEV_SCENARIO_NAMES.map((name) => (
        <a
          key={name}
          href={`?dev=${name}`}
          className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${
            name === currentScenario
              ? "bg-sky-500 text-white"
              : "bg-slate-200 text-slate-500 hover:bg-slate-300 dark:bg-slate-700 dark:text-slate-400 dark:hover:bg-slate-600"
          }`}
        >
          {name}
        </a>
      ))}
    </div>
  );
}

function DevPanel({ gameState }: { gameState: GameState }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="border-t border-slate-200 bg-slate-50/80 px-3 py-1 dark:border-slate-700 dark:bg-slate-900/80">
      <button
        type="button"
        className="text-[9px] font-semibold text-slate-400 hover:text-slate-600"
        onClick={() => setIsOpen((c) => !c)}
      >
        {isOpen ? "Hide" : "Dev"}
      </button>
      {isOpen && (
        <pre className="mt-1 max-h-32 overflow-auto text-[9px] text-slate-500">
          {JSON.stringify(gameState, null, 2)}
        </pre>
      )}
    </div>
  );
}
