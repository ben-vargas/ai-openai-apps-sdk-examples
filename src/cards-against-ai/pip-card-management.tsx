import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { useGameManagement, useGameState } from "./game-management";
import type { GameState } from "./types";

export interface CardState {
  x: number;
  y: number;
  rotation: number;
  faceUp: boolean;
  interactive: boolean;
  status: "active" | "exiting" | "entering";
}

interface PipCardManager {
  cards: Map<string, CardState>;
  getCardState(cardId: string): CardState;
  handleCardTransitionEnd(cardId: string): void;
}

const DEFAULT_CARD_STATE: CardState = {
  x: 0,
  y: 0,
  rotation: 0,
  faceUp: false,
  interactive: false,
  status: "active",
};

const CARD_W = 138;
const CARD_H = 193;
const DEALER_SPOT = { x: -CARD_W, y: -CARD_H };
const FLIP_DELAY = 650;
const HAND_ROTATION_STEP = 4;
const HAND_MIN_GAP = 16;
const HAND_MAX_GAP = 60;
const PLAYED_GAP = 12;
const PROMPT_TOP_Y = 12;
const HAND_BOTTOM_PADDING = 12;

interface PlayAreaBounds {
  width: number;
  height: number;
}

function getLocalPlayerIndex(gameState: GameState, localPlayerId: string | null) {
  if (localPlayerId && gameState.players.length > 0) {
    const idx = gameState.players.findIndex((p) => p.id === localPlayerId);
    if (idx >= 0) return idx;
  }
  return -1;
}

function buildPipCardStateMap(
  gameState: GameState,
  bounds: PlayAreaBounds,
  localPlayerId: string | null,
) {
  const cards: Record<string, CardState> = {};

  // Prompt: top center
  if (gameState.prompt) {
    const promptX = (bounds.width - CARD_W) / 2;
    cards[gameState.prompt.id] = {
      x: promptX,
      y: PROMPT_TOP_Y,
      rotation: 0,
      faceUp: true,
      interactive: false,
      status: "active",
    };
  }

  const isLocalJudge =
    localPlayerId != null &&
    gameState.players[gameState.currentJudgePlayerIndex]?.id === localPlayerId;

  // Played/judged cards: bottom center
  if (gameState.playedAnswerCards.length > 0) {
    const count = gameState.playedAnswerCards.length;
    const totalWidth = count * CARD_W + (count - 1) * PLAYED_GAP;
    const startX = (bounds.width - totalWidth) / 2;
    const y = bounds.height - HAND_BOTTOM_PADDING - CARD_H;

    for (let i = 0; i < count; i++) {
      const played = gameState.playedAnswerCards[i];
      const x = startX + i * (CARD_W + PLAYED_GAP);
      cards[played.cardId] = {
        x,
        y,
        rotation: 0,
        faceUp: gameState.status !== "waiting-for-answers",
        interactive: isLocalJudge && gameState.status === "judging",
        status: "active",
      };
    }
  }

  // Local player hand: bottom center, fanned
  const localPlayerIndex = getLocalPlayerIndex(gameState, localPlayerId);
  const localPlayer =
    localPlayerIndex >= 0 ? gameState.players[localPlayerIndex] : null;

  const localPlayerHasPlayed = gameState.playedAnswerCards.some(
    (p) => p.playerId === localPlayerId,
  );

  if (localPlayer && localPlayer.answerCards.length > 0 && !localPlayerHasPlayed && !isLocalJudge && gameState.status === "waiting-for-answers") {
    const isWaitingForAnswers = gameState.status === "waiting-for-answers";
    const cardCount = localPlayer.answerCards.length;
    const availableWidth = bounds.width - 24; // small side padding
    const maxGap =
      cardCount > 1
        ? (availableWidth - CARD_W) / (cardCount - 1)
        : 0;
    const gap = Math.max(HAND_MIN_GAP, Math.min(HAND_MAX_GAP, maxGap));
    const totalWidth =
      cardCount > 0 ? CARD_W + (cardCount - 1) * gap : CARD_W;
    const startX = (bounds.width - totalWidth) / 2;
    const y = bounds.height - HAND_BOTTOM_PADDING - CARD_H;
    const midIndex = (cardCount - 1) / 2;

    for (let i = 0; i < cardCount; i++) {
      const cardId = localPlayer.answerCards[i];
      const offset = i - midIndex;
      cards[cardId] = {
        x: startX + i * gap,
        y,
        rotation: offset * HAND_ROTATION_STEP,
        faceUp: true,
        interactive: isWaitingForAnswers && !isLocalJudge,
        status: "active",
      };
    }
  }

  return cards;
}

function createEnteringState(cardState: CardState): CardState {
  return {
    ...cardState,
    faceUp: false,
    interactive: false,
    status: "entering",
  };
}

// --- Reducer ---

interface SyncWithGameStateAction {
  type: "SYNC_WITH_GAME_STATE";
  gameState: GameState;
  bounds: PlayAreaBounds;
  localPlayerId: string | null;
  seedEntering: boolean;
}

interface ApplyPendingCardsAction {
  type: "APPLY_PENDING_CARDS";
}

interface FinalizeEnteringCardAction {
  type: "FINALIZE_ENTERING_CARD";
  cardId: string;
}

interface RemoveCardAction {
  type: "REMOVE_CARD";
  cardId: string;
}

type PipCardAction =
  | SyncWithGameStateAction
  | ApplyPendingCardsAction
  | FinalizeEnteringCardAction
  | RemoveCardAction;

interface PipCardManagerState {
  cards: Map<string, CardState>;
  pendingCards: Map<string, CardState> | null;
  enteringTargets: Map<string, CardState>;
}

function pipCardReducer(
  state: PipCardManagerState,
  action: PipCardAction,
): PipCardManagerState {
  switch (action.type) {
    case "SYNC_WITH_GAME_STATE": {
      const nextCards = buildPipCardStateMap(
        action.gameState,
        action.bounds,
        action.localPlayerId,
      );
      const finalCards = new Map<string, CardState>();
      const nextEnteringTargets = new Map<string, CardState>();
      const enteringCardIds: string[] = [];
      const discardedCardIds = new Set<string>([
        ...action.gameState.discardedAnswerCards,
        ...action.gameState.discardedPromptCards.map((p) => p.id),
      ]);

      for (const [cardId, cardState] of Object.entries(nextCards)) {
        const existingCard = state.cards.get(cardId);
        const targetCard: CardState = { ...cardState, status: "active" };

        if (existingCard?.status === "entering") {
          nextEnteringTargets.set(cardId, targetCard);
          finalCards.set(cardId, createEnteringState(targetCard));
          continue;
        }
        if (!existingCard) {
          enteringCardIds.push(cardId);
        }
        finalCards.set(cardId, targetCard);
      }

      // Mark discarded cards as exiting
      for (const [cardId, cardState] of state.cards) {
        if (finalCards.has(cardId)) continue;
        if (!discardedCardIds.has(cardId)) continue;
        finalCards.set(cardId, {
          ...cardState,
          x: DEALER_SPOT.x,
          y: DEALER_SPOT.y,
          interactive: false,
          status: "exiting",
        });
      }

      // Two-phase entering: seed at dealer spot, apply targets next frame
      if (action.seedEntering && enteringCardIds.length > 0) {
        const seededCards = new Map(finalCards);
        for (const cardId of enteringCardIds) {
          const targetCard = finalCards.get(cardId);
          if (!targetCard) continue;
          nextEnteringTargets.set(cardId, targetCard);
          const enteringCard = createEnteringState(targetCard);
          seededCards.set(cardId, {
            ...enteringCard,
            x: DEALER_SPOT.x,
            y: DEALER_SPOT.y,
            rotation: 0,
          });
          finalCards.set(cardId, enteringCard);
        }
        return {
          ...state,
          cards: seededCards,
          pendingCards: finalCards,
          enteringTargets: nextEnteringTargets,
        };
      }

      return {
        ...state,
        cards: finalCards,
        pendingCards: null,
        enteringTargets: nextEnteringTargets,
      };
    }
    case "APPLY_PENDING_CARDS": {
      if (!state.pendingCards) return state;
      return {
        ...state,
        cards: state.pendingCards,
        pendingCards: null,
      };
    }
    case "FINALIZE_ENTERING_CARD": {
      const targetCard = state.enteringTargets.get(action.cardId);
      if (!targetCard) return state;
      const nextCards = new Map(state.cards);
      nextCards.set(action.cardId, targetCard);
      const nextEnteringTargets = new Map(state.enteringTargets);
      nextEnteringTargets.delete(action.cardId);
      return {
        ...state,
        cards: nextCards,
        enteringTargets: nextEnteringTargets,
      };
    }
    case "REMOVE_CARD": {
      if (!state.cards.has(action.cardId)) return state;
      const nextCards = new Map(state.cards);
      nextCards.delete(action.cardId);
      const nextPendingCards = state.pendingCards
        ? new Map(state.pendingCards)
        : null;
      nextPendingCards?.delete(action.cardId);
      const nextEnteringTargets = new Map(state.enteringTargets);
      nextEnteringTargets.delete(action.cardId);
      return {
        ...state,
        cards: nextCards,
        pendingCards: nextPendingCards,
        enteringTargets: nextEnteringTargets,
      };
    }
    default:
      return state;
  }
}

// --- Context ---

const PipCardManagementContext = createContext<PipCardManager | null>(null);

export function PipCardManagementProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const { localPlayerId } = useGameManagement();
  const gameState = useGameState();
  const [state, dispatch] = useReducer(pipCardReducer, {
    cards: new Map<string, CardState>(),
    pendingCards: null,
    enteringTargets: new Map(),
  });
  const playAreaRef = useRef<HTMLDivElement | null>(null);
  const lastBoundsRef = useRef<PlayAreaBounds | null>(null);
  const enteringTimeoutsRef = useRef<Map<string, number>>(new Map());
  const gameStateRef = useRef(gameState);
  gameStateRef.current = gameState;
  const localPlayerIdRef = useRef(localPlayerId);
  localPlayerIdRef.current = localPlayerId;

  const getPlayAreaBounds = useCallback((): PlayAreaBounds | null => {
    const container = playAreaRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return { width: rect.width, height: rect.height };
  }, []);

  // Sync with game state changes
  useEffect(() => {
    const bounds = getPlayAreaBounds();
    if (!bounds) return;
    dispatch({
      type: "SYNC_WITH_GAME_STATE",
      gameState,
      bounds,
      localPlayerId,
      seedEntering: true,
    });
  }, [gameState, getPlayAreaBounds, localPlayerId]);

  // ResizeObserver for responsive recalculation
  useEffect(() => {
    const container = playAreaRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;

    const handleResize = () => {
      const nextBounds = getPlayAreaBounds();
      if (!nextBounds) return;
      const last = lastBoundsRef.current;
      if (last && last.width === nextBounds.width && last.height === nextBounds.height) return;
      lastBoundsRef.current = nextBounds;
      dispatch({
        type: "SYNC_WITH_GAME_STATE",
        gameState: gameStateRef.current,
        bounds: nextBounds,
        localPlayerId: localPlayerIdRef.current,
        seedEntering: false,
      });
    };

    const observer = new ResizeObserver(handleResize);
    observer.observe(container);

    return () => observer.disconnect();
  }, [getPlayAreaBounds]);

  // Apply pending cards after paint (two-phase entering)
  useEffect(() => {
    if (!state.pendingCards) return;
    dispatch({ type: "APPLY_PENDING_CARDS" });
  }, [state.pendingCards]);

  // Cleanup entering timeouts on unmount
  useEffect(() => {
    return () => {
      for (const timeoutId of enteringTimeoutsRef.current.values()) {
        clearTimeout(timeoutId);
      }
      enteringTimeoutsRef.current.clear();
    };
  }, []);

  // Schedule flip completion for entering cards
  useEffect(() => {
    const activeCardIds = new Set(state.cards.keys());

    for (const [cardId, timeoutId] of enteringTimeoutsRef.current) {
      if (!activeCardIds.has(cardId)) {
        clearTimeout(timeoutId);
        enteringTimeoutsRef.current.delete(cardId);
      }
    }

    for (const [cardId, cardState] of state.cards) {
      const hasTimeout = enteringTimeoutsRef.current.has(cardId);
      if (cardState.status !== "entering") {
        if (hasTimeout) {
          const tid = enteringTimeoutsRef.current.get(cardId);
          if (tid != null) clearTimeout(tid);
          enteringTimeoutsRef.current.delete(cardId);
        }
        continue;
      }
      if (hasTimeout) continue;
      const timeoutId = window.setTimeout(() => {
        dispatch({ type: "FINALIZE_ENTERING_CARD", cardId });
      }, FLIP_DELAY);
      enteringTimeoutsRef.current.set(cardId, timeoutId);
    }
  }, [state.cards]);

  const getCardState = useCallback(
    (cardId: string) => {
      return state.cards.get(cardId) ?? DEFAULT_CARD_STATE;
    },
    [state.cards],
  );

  const handleCardTransitionEnd = useCallback(
    (cardId: string) => {
      const cardState = state.cards.get(cardId);
      if (!cardState) return;
      if (cardState.status === "exiting") {
        dispatch({ type: "REMOVE_CARD", cardId });
        return;
      }
      if (cardState.status === "entering") {
        dispatch({ type: "FINALIZE_ENTERING_CARD", cardId });
      }
    },
    [state.cards],
  );

  const cardManager = useMemo<PipCardManager>(
    () => ({
      cards: state.cards,
      getCardState,
      handleCardTransitionEnd,
    }),
    [getCardState, handleCardTransitionEnd, state.cards],
  );

  return (
    <PipCardManagementContext.Provider value={cardManager}>
      <div
        ref={playAreaRef}
        className="relative h-full w-full overflow-hidden"
      >
        {children}
      </div>
    </PipCardManagementContext.Provider>
  );
}

export function usePipCardManagement() {
  const ctx = useContext(PipCardManagementContext);
  if (!ctx) {
    throw new Error("PipCardManagementContext not found");
  }
  return ctx;
}

export function usePipCardState(cardId: string) {
  const { getCardState } = usePipCardManagement();
  return useMemo(() => getCardState(cardId), [cardId, getCardState]);
}
