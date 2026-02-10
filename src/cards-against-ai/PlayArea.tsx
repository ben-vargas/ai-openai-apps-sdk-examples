import { useEffect, useMemo, useRef, useState } from "react";
import { CARD_HEIGHT, CARD_WIDTH, AnswerCard, PromptCard } from "./Cards";
import { Scoreboard } from "./Scoreboard";
import type { GameState } from "./types";

interface Bounds {
  width: number;
  height: number;
}

interface CardPosition {
  x: number;
  y: number;
  rotation: number;
}

/**
 * The position of the card in the dealer's hand. This is used
 * as an "offscreen" position for cards that are being dealt, or discarded.
 */
const CARD_DEALER_SPOT: CardPosition = { x: -CARD_WIDTH, y: -CARD_HEIGHT, rotation: 0 };

const CARD_FLIP_DELAY = 650;
const CARD_HAND_ROTATION_STEP = 4;
const CARD_HAND_MIN_GAP = 16;
const CARD_HAND_MAX_GAP = 60;
const CARD_PLAYED_GAP = 12;
const CARD_PROMPT_TOP_Y = 12;
const CARD_HAND_BOTTOM_PADDING = 12;
const ANSWER_CARDS_OFFSCREEN_POSITION_Y = CARD_HEIGHT + 10;

export interface PlayAreaProps {
  gameState: GameState;
}

// --- Position helpers ---

function getPromptCardPosition(boundsWidth: number): CardPosition {
  return {
    x: (boundsWidth - CARD_WIDTH) / 2,
    y: CARD_PROMPT_TOP_Y,
    rotation: 0,
  };
}

function getPlayedAnswerCardsPositions(
  count: number,
  bounds: Bounds,
): CardPosition[] {
  if (count === 0) return [];
  const totalWidth = count * CARD_WIDTH + (count - 1) * CARD_PLAYED_GAP;
  const startX = (bounds.width - totalWidth) / 2;
  const y = CARD_PROMPT_TOP_Y + CARD_HEIGHT + 20;
  const positions: CardPosition[] = [];
  for (let i = 0; i < count; i++) {
    positions.push({
      x: startX + i * (CARD_WIDTH + CARD_PLAYED_GAP),
      y,
      rotation: 0,
    });
  }
  return positions;
}

function getHandCardPositions(
  count: number,
  bounds: Bounds,
): CardPosition[] {
  if (count === 0) return [];
  const availableWidth = bounds.width - 24;
  const maxGap =
    count > 1 ? (availableWidth - CARD_WIDTH) / (count - 1) : 0;
  const gap = Math.max(CARD_HAND_MIN_GAP, Math.min(CARD_HAND_MAX_GAP, maxGap));
  const totalWidth = CARD_W_PLUS_GAP(count, gap);
  const startX = (bounds.width - totalWidth) / 2;
  const y = bounds.height - CARD_HAND_BOTTOM_PADDING - CARD_HEIGHT;
  const midIndex = (count - 1) / 2;

  const positions: CardPosition[] = [];
  for (let i = 0; i < count; i++) {
    positions.push({
      x: startX + i * gap,
      y,
      rotation: (i - midIndex) * CARD_HAND_ROTATION_STEP,
    });
  }
  return positions;
}

function CARD_W_PLUS_GAP(count: number, gap: number): number {
  return count > 0 ? CARD_WIDTH + (count - 1) * gap : CARD_WIDTH;
}

function getOffscreenHandCardPositions(
  count: number,
  bounds: Bounds,
): CardPosition[] {
  const viewable = getHandCardPositions(count, bounds);
  return viewable.map((pos) => ({
    ...pos,
    y: bounds.height + ANSWER_CARDS_OFFSCREEN_POSITION_Y,
  }));
}

// --- Component ---

/**
 * Responsible for displaying the game state.
 * Does the work of figuring out where to position the cards,
 * accounting for the status of the gameState, and making sure things
 * are displayed correctly.
 */
export function PlayArea({ gameState }: PlayAreaProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [bounds, setBounds] = useState<Bounds | null>(null);

  // Track entering cards for the seed → slide → flip animation sequence
  const [enteringCardIds, setEnteringCardIds] = useState<Set<string>>(
    new Set(),
  );
  const [unflippedCardIds, setUnflippedCardIds] = useState<Set<string>>(
    new Set(),
  );
  const knownCardIdsRef = useRef<Set<string>>(new Set());

  // --- ResizeObserver for container bounds ---
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      setBounds((prev) =>
        prev && prev.width === width && prev.height === height
          ? prev
          : { width, height },
      );
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // --- Detect new cards and seed entering animation ---
  const currentCardIds = useMemo(() => {
    const ids = new Set<string>();

    if (gameState.prompt) ids.add(gameState.prompt.id);
    
    for (const played of gameState.playedAnswerCards) {
      ids.add(played.cardId);
    }
    
    const localPlayer = gameState.players.find((p) => p.type === "human");
    
    if (localPlayer) {
      for (const cardId of localPlayer.answerCards) {
        ids.add(cardId);
      }
    }
    
    return ids;
  }, [gameState]);

  useEffect(() => {
    const newIds: string[] = [];
    
    for (const id of currentCardIds) {
      if (!knownCardIdsRef.current.has(id)) {
        newIds.push(id);
      }
    }

    if (newIds.length > 0) {
      const newSet = new Set(newIds);
      setEnteringCardIds(newSet);
      setUnflippedCardIds(newSet);
    }

    knownCardIdsRef.current = currentCardIds;
  }, [currentCardIds]);

  // Phase 2: After seeding at dealer spot, clear enteringCardIds to trigger CSS slide
  useEffect(() => {
    if (enteringCardIds.size === 0) return;
    
    const id = requestAnimationFrame(() => {
        setEnteringCardIds(new Set());
    });

    return () => {
      cancelAnimationFrame(id);
    };
  }, [enteringCardIds]);

  // Phase 3: After slide, flip the cards
  useEffect(() => {
    if (unflippedCardIds.size === 0) return;
    
    const timeout = setTimeout(() => {
      setUnflippedCardIds(new Set());
    }, CARD_FLIP_DELAY);

    return () => {
        clearTimeout(timeout);
    };
  }, [unflippedCardIds]);

  // --- Build positioned card elements ---
  const localPlayerId = getLocalPlayerId(gameState);

  const positionedCards = useMemo<React.ReactNode[]>(() => {
    if (!bounds) return [];

    const { status, prompt, playedAnswerCards, players, currentJudgePlayerIndex } = gameState;

    const isEntering = (id: string) => enteringCardIds.has(id);
    const isFaceDown = (id: string) => unflippedCardIds.has(id);

    const localPlayer = players.find((p) => p.type === "human");
    const isLocalJudge = localPlayer
      ? players[currentJudgePlayerIndex]?.id === localPlayer.id
      : false;
    const localPlayerHasPlayed = localPlayer
      ? playedAnswerCards.some((p) => p.playerId === localPlayer.id)
      : false;

    const elements: React.ReactNode[] = [];

    const addPrompt = (faceUp: boolean) => {
      if (!prompt) return;
      const pos = isEntering(prompt.id)
        ? CARD_DEALER_SPOT
        : getPromptCardPosition(bounds.width);
      elements.push(
        <PromptCard
          key={prompt.id}
          x={pos.x}
          y={pos.y}
          rotation={pos.rotation}
          faceUp={faceUp && !isFaceDown(prompt.id)}
          text={prompt.text}
        />,
      );
    };

    const addPlayedCards = (faceUp: boolean) => {
      if (playedAnswerCards.length === 0) return;
      const positions = getPlayedAnswerCardsPositions(
        playedAnswerCards.length,
        bounds,
      );
      for (let i = 0; i < playedAnswerCards.length; i++) {
        const played = playedAnswerCards[i];
        const answerCard = gameState.answerCards[played.cardId];
        if (!answerCard) continue;
        const pos = isEntering(played.cardId)
          ? CARD_DEALER_SPOT
          : positions[i];
        elements.push(
          <AnswerCard
            key={played.cardId}
            x={pos.x}
            y={pos.y}
            rotation={pos.rotation}
            faceUp={faceUp && !isFaceDown(played.cardId)}
            text={answerCard.text}
          />,
        );
      }
    };

    const addHandCards = (offscreen: boolean) => {
      if (!localPlayer || localPlayer.answerCards.length === 0) return;
      // Don't show hand if local player is judge or has already played
      if (offscreen || isLocalJudge || localPlayerHasPlayed) {
        const positions = getOffscreenHandCardPositions(
          localPlayer.answerCards.length,
          bounds,
        );
        for (let i = 0; i < localPlayer.answerCards.length; i++) {
          const cardId = localPlayer.answerCards[i];
          const answerCard = gameState.answerCards[cardId];
          if (!answerCard) continue;
          const pos = isEntering(cardId)
            ? CARD_DEALER_SPOT
            : positions[i];
          elements.push(
            <AnswerCard
              key={cardId}
              x={pos.x}
              y={pos.y}
              rotation={pos.rotation}
              faceUp={!isFaceDown(cardId)}
              text={answerCard.text}
            />,
          );
        }
        return;
      }
      const positions = getHandCardPositions(
        localPlayer.answerCards.length,
        bounds,
      );

      for (let i = 0; i < localPlayer.answerCards.length; i++) {
        const cardId = localPlayer.answerCards[i];
        const answerCard = gameState.answerCards[cardId];
        if (!answerCard) continue;
        const pos = isEntering(cardId) ? CARD_DEALER_SPOT : positions[i];
        elements.push(
          <AnswerCard
            key={cardId}
            x={pos.x}
            y={pos.y}
            rotation={pos.rotation}
            faceUp={!isFaceDown(cardId)}
            text={answerCard.text}
          />,
        );
      }
    };

    switch (status) {
      case "initializing":
      case "waiting-for-players":
      case "game-ended":
        return [];

      case "dealing":
        addPrompt(true);
        addHandCards(false);
        break;

      case "waiting-for-answers":
        addPrompt(true);
        addPlayedCards(false); // face down during answering
        addHandCards(false);
        break;

      case "judging":
        addPrompt(true);
        addPlayedCards(true);
        addHandCards(true); // offscreen
        break;

      case "display-judgement":
        addPrompt(true);
        addPlayedCards(true);
        addHandCards(true); // offscreen
        break;

      case "clearing-played-cards": {
        // Prompt and played cards animate to dealer spot
        if (prompt) {
          elements.push(
            <PromptCard
              key={prompt.id}
              x={CARD_DEALER_SPOT.x}
              y={CARD_DEALER_SPOT.y}
              rotation={0}
              faceUp={false}
              text={prompt.text}
            />,
          );
        }
        for (const played of playedAnswerCards) {
          const answerCard = gameState.answerCards[played.cardId];
          if (!answerCard) continue;
          elements.push(
            <AnswerCard
              key={played.cardId}
              x={CARD_DEALER_SPOT.x}
              y={CARD_DEALER_SPOT.y}
              rotation={0}
              faceUp={false}
              text={answerCard.text}
            />,
          );
        }
        // Hand cards animate in for next round
        addHandCards(false);
        break;
      }

      case "announce-winner":
        addPrompt(true);
        addPlayedCards(true);
        addHandCards(true); // offscreen
        break;

      default: {
        const _exhaustive: never = status;
        throw new Error(`Unknown game status: ${_exhaustive}`);
      }
    }

    return elements;
  }, [gameState, bounds, enteringCardIds, unflippedCardIds, localPlayerId]);

  const { players, currentJudgePlayerIndex } = gameState;

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden">
      {positionedCards}
      <div className="absolute right-2 top-2 z-10">
        <Scoreboard
          players={players}
          currentJudgePlayerIndex={currentJudgePlayerIndex}
          localPlayerId={localPlayerId}
        />
      </div>
    </div>
  );
}

function getLocalPlayerId(gameState: GameState): string | null {
  return gameState.players.find((p) => p.type === "human")?.id ?? null;
}
