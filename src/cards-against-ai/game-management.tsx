import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
} from "react";
import { buildApiUrl } from "./api-base-url";
import {
  AnswerCard,
  GameState,
  GameStatus,
  JudgementResult,
  Player,
  PromptCard,
} from "./types";
import { fetchPromptCard } from "./fetchPromptCard";
import { fetchFakePlayers } from "./fetchPlayers";
import { fetchFakeAnswerDeck } from "./fetchAnswerDeck";

const TARGET_HAND_SIZE = 7;

export function getAnswerCardById(state: GameState, cardId: string): AnswerCard {
  const card = state.answerCards[cardId];
  if (!card) {
    throw new Error(`Answer card not found: ${cardId}`);
  }
  return card;
}

export function getAnswerCardsByIds(
  state: GameState,
  cardIds: string[],
): AnswerCard[] {
  const cards: AnswerCard[] = [];
  for (const cardId of cardIds) {
    cards.push(getAnswerCardById(state, cardId));
  }
  return cards;
}

export interface GameManager {
  gameState: GameState;
  localPlayerId: string | null;
  playAnswerCard(cardId: string, player: Player): Promise<void>;
  judgeAnswerCard(cardId: string, judge: Player): Promise<void>;
  dealCards(
    playersSnapshot: Player[],
    deckSnapshot: AnswerCard[],
  ): Promise<void>;
  setAnswerDeck(answerDeck: string[]): void;
}

const GameManagementContext = createContext<GameManager | null>(null);

interface GameManagementProviderProps {
  children: React.ReactNode;
  gameId: string | null;
  gameKey: string | null;
  localPlayerId: string | null;
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
  outcomeReactions: [],
});

interface ServerStateChangedAction {
  type: "SERVER_STATE_CHANGED";
  state: GameState;
}

interface PlayAnswerCardAction {
  type: "PLAY_ANSWER_CARD";
  cardId: string;
  player: Player;
}

interface SetPlayersAndDeckAction {
  type: "SET_PLAYERS_AND_DECK";
  players: Player[];
  answerDeck: string[];
}

interface SetPromptAction {
  type: "SET_PROMPT";
  prompt: PromptCard;
}

interface SetAnswerDeckAction {
  type: "SET_ANSWER_DECK";
  answerDeck: string[];
}

interface SetStatusAction {
  type: "SET_STATUS";
  status: GameStatus;
}

type GameAction =
  | ServerStateChangedAction
  | PlayAnswerCardAction
  | SetPlayersAndDeckAction
  | SetPromptAction
  | SetAnswerDeckAction
  | SetStatusAction;

function applyPlayAnswerCardAction(
  prev: GameState,
  action: PlayAnswerCardAction,
): GameState {
  if (prev.status !== "waiting-for-answers") {
    throw new Error(`Cannot play answer card while game is ${prev.status}`);
  }

  if (prev.playedAnswerCards.some((played) => played.playerId === action.player.id)) {
    throw new Error(`Player ${action.player.id} has already played a card`);
  }

  if (!action.player.answerCards.includes(action.cardId)) {
    throw new Error(
      `Player ${action.player.id} does not have this card in their hand`,
    );
  }

  return {
    ...prev,
    playedAnswerCards: [
      ...prev.playedAnswerCards,
      { cardId: action.cardId, playerId: action.player.id },
    ],
    players: prev.players.map((player) =>
      player.id === action.player.id
        ? {
            ...player,
            answerCards: player.answerCards.filter(
              (cardId) => cardId !== action.cardId,
            ),
          }
        : player,
    ),
  };
}

function applyCommonAction(prev: GameState, action: GameAction): GameState | null {
  switch (action.type) {
    case "SET_PLAYERS_AND_DECK":
      return { ...prev, players: action.players, answerDeck: action.answerDeck };
    case "SET_PROMPT":
      return { ...prev, prompt: action.prompt };
    case "SET_ANSWER_DECK":
      return { ...prev, answerDeck: action.answerDeck };
    case "SET_STATUS":
      return { ...prev, status: action.status };
    default:
      return null;
  }
}

function createStatusReducer(
  status: GameStatus,
): (prev: GameState, action: GameAction) => GameState {
  switch (status) {
    case "waiting-for-answers":
      return (prev, action) => {
        if (action.type === "PLAY_ANSWER_CARD") {
          return applyPlayAnswerCardAction(prev, action);
        }

        const next = applyCommonAction(prev, action);
        return next ?? prev;
      };
    case "dealing":
    case "prepare-for-next-round":
      return (prev, action) => {
        const next = applyCommonAction(prev, action);
        return next ?? prev;
      };
    default:
      return (prev, action) => {
        const next = applyCommonAction(prev, action);
        return next ?? prev;
      };
  }
}

export function GameManagementProvider({
  children,
  gameId,
  gameKey,
  localPlayerId,
}: GameManagementProviderProps) {
  const runGameLogicRef = useRef(
    (prev: GameState, _action: GameAction) => prev,
  );
  const [gameState, dispatch] = useReducer(
    (prev: GameState, action: GameAction) => {
      if (action.type === "SERVER_STATE_CHANGED") {
        return action.state;
      }

      return runGameLogicRef.current(prev, action);
    },
    createInitialGameState(gameKey),
  );

  const runGameLogic = useMemo(
    () => createStatusReducer(gameState.status),
    [gameState.status],
  );

  useEffect(() => {
    runGameLogicRef.current = runGameLogic;
  }, [runGameLogic]);

  const handleGameEvent = useCallback(
    (event: { type: "state-changed"; data: GameState }) => {
      dispatch({ type: "SERVER_STATE_CHANGED", state: event.data });
    },
    [],
  );

  useGameEvents(handleGameEvent, { gameId });

  const playAnswerCard = useCallback(
    async (cardId: string, player: Player) => {
      if (!gameId) {
        dispatch({ type: "PLAY_ANSWER_CARD", cardId, player });
        return;
      }

      try {
        const response = await fetch(buildApiUrl(`/game/${gameId}/actions`), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: "PLAYER_PLAYED_ANSWER_CARD",
            playerId: player.id,
            cardId,
          }),
        });
        if (!response.ok) {
          const body = await response.text();
          throw new Error(body || response.statusText);
        }
      } catch (error) {
        console.error("[cards-ai] failed to play answer card", error);
      }
    },
    [gameId],
  );

  const judgeAnswerCard = useCallback(
    async (cardId: string, judge: Player) => {
      const playedCard = gameState.playedAnswerCards.find(
        (played) => played.cardId === cardId,
      );
      if (!playedCard) {
        console.warn("[cards-ai] missing played answer card", { cardId });
        return;
      }

      const result: JudgementResult = {
        judgeId: judge.id,
        winningCardId: cardId,
        winningPlayerId: playedCard.playerId,
      };

      if (!gameId) {
        console.warn("[cards-ai] missing game id for judgement", { result });
        return;
      }

      try {
        const response = await fetch(buildApiUrl(`/game/${gameId}/actions`), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: "RETURN_JUDGEMENT",
            result,
          }),
        });
        if (!response.ok) {
          const body = await response.text();
          throw new Error(body || response.statusText);
        }
      } catch (error) {
        console.error("[cards-ai] failed to submit judgement", error);
      }
    },
    [gameId, gameState.playedAnswerCards],
  );

  const dealCards = useCallback(
    async (playersSnapshot: Player[], deckSnapshot: AnswerCard[]) => {
      let i = 0;
      const deck = deckSnapshot.map((card) => card.id);
      const players = playersSnapshot.map((player) => ({
        ...player,
        answerCards: [...player.answerCards],
      }));

      dispatch({ type: "SET_STATUS", status: "dealing" });

      while (
        players.some((player) => player.answerCards.length < TARGET_HAND_SIZE)
      ) {
        await new Promise((resolve) => setTimeout(resolve, 200));
        const playerIndex = i % players.length;
        const player = players[playerIndex];
        if (player.answerCards.length < TARGET_HAND_SIZE) {
          const nextCardId = deck.shift();
          if (!nextCardId) {
            throw new Error(`No more cards to deal`);
          }
          player.answerCards.push(nextCardId);
          const playersSnapshot = players.map((entry) => ({
            ...entry,
            answerCards: [...entry.answerCards],
          }));
          dispatch({
            type: "SET_PLAYERS_AND_DECK",
            players: playersSnapshot,
            answerDeck: [...deck],
          });
        }
        i++;
      }

      dispatch({ type: "SET_STATUS", status: "dealing" });
    },
    [],
  );

  const setAnswerDeck = useCallback((answerDeck: string[]) => {
    dispatch({ type: "SET_ANSWER_DECK", answerDeck });
  }, []);

  const gameManager = useMemo(
    () => ({
      gameState,
      localPlayerId,
      playAnswerCard,
      judgeAnswerCard,
      dealCards,
      setAnswerDeck,
    }),
    [
      gameState,
      localPlayerId,
      playAnswerCard,
      judgeAnswerCard,
      dealCards,
      setAnswerDeck,
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

function useGameEvents(
  callback: (event: { type: "state-changed"; data: GameState }) => void,
  options: { gameId: string | null },
) {
  const { gameId } = options;
  const isFallback = gameId == null;

  useEffect(() => {
    let isMounted = true;

    if (isFallback) {
      (async () => {
        const baseState = createInitialGameState(null);
        const players: Player[] = [];
        for await (const player of fetchFakePlayers()) {
          players.push(player);
        }

        const answerDeck = await fetchFakeAnswerDeck();
        const deck = answerDeck.map((card) => card.id);
        const answerCards: Record<string, AnswerCard> = {};
        for (const card of answerDeck) {
          answerCards[card.id] = card;
        }
        const dealtPlayers: Player[] = [];

        for (const player of players) {
          const hand: string[] = [];
          while (hand.length < TARGET_HAND_SIZE && deck.length > 0) {
            const nextCardId = deck.shift();
            if (!nextCardId) {
              break;
            }
            hand.push(nextCardId);
          }
          dealtPlayers.push({ ...player, answerCards: hand });
        }

        const prompt = await fetchPromptCard();

        if (!isMounted) {
          return;
        }

        const fakeState: GameState = {
          ...baseState,
          answerCards,
          players: dealtPlayers,
          answerDeck: deck,
          prompt,
          status: "waiting-for-answers",
          currentJudgePlayerIndex: 0,
        };

        callback({ type: "state-changed", data: fakeState });
      })();

      return () => {
        isMounted = false;
      };
    }

    const eventUrl = buildApiUrl(`/game/${gameId}/events`);
    const streamLabel = `[cards-ai events ${gameId}]`;
    console.info(`${streamLabel} connecting`, { url: eventUrl });

    const eventSource = new EventSource(eventUrl);
    eventSource.onopen = () => {
      console.info(`${streamLabel} connected`);
    };
    eventSource.onerror = (error) => {
      console.error(`${streamLabel} error`, error);
      if (import.meta.env.DEV && typeof window !== "undefined") {
        try {
          window.sessionStorage.removeItem("cards-against-ai-dev-game");
        } catch {
          // ignore cache clearing errors
        }
      }
    };
    const handleStateEvent = (event: MessageEvent<string>) => {
      try {
        const data = JSON.parse(event.data) as GameState;
        const parsed = { type: "state-changed", data } as const;
        console.info(`${streamLabel} state`, parsed);
        callback(parsed);
      } catch (error) {
        console.error(`${streamLabel} state parse failed`, {
          error,
          raw: event.data,
        });
      }
    };

    eventSource.addEventListener("state", handleStateEvent);

    return () => {
      console.info(`${streamLabel} closing`);
      eventSource.removeEventListener("state", handleStateEvent);
      eventSource.close();
    };
  }, [callback, gameId, isFallback]);
}