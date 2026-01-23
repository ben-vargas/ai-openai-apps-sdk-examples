import {
    type CSSProperties,
    createContext,
    useCallback,
    useContext,
    useEffect,
    useMemo,
    useReducer,
    useRef,
} from "react";
import { getAssetsBaseUrl } from "./api-base-url";
import cardBackPattern from "./assets/card-back-pattern.png";
import { useGameManagement, useGameState } from "./game-management";
import { GameState } from "./types";

interface CardProps {
    id: string;
    children: React.ReactNode;
    onClick?: () => void;
    invertColors?: boolean;
    isWinner?: boolean;
}

export interface CardState {
    x: number;
    y: number;
    rotation: number;
    faceUp: boolean;
    interactive: boolean;
    status: "active" | "exiting" | "entering";
}

export interface CardLayout {
    playerPanels: Record<string, { centerX: number; topY: number }>;
}

interface NonLocalPlayerHand {
    player: GameState["players"][number];
    cardCount: number;
}

export function Card(props: CardProps) {
    const cardState = useCardState(props.id);
    const { handleCardTransitionEnd } = useCardManagement();

    const cardStyle = {
        "--card-x": `${cardState.x}px`,
        "--card-y": `${cardState.y}px`,
        "--card-rotation": `${cardState.rotation}deg`,
        "--card-flip-rotation": cardState.faceUp ? "0deg" : "180deg",
    } as CSSProperties;

    const assetsBaseUrl = getAssetsBaseUrl();

    const cardBackPatternUrl = assetsBaseUrl ? new URL(cardBackPattern, assetsBaseUrl).toString() : cardBackPattern;

    const cardBackStyle = {
        backgroundImage: `url(${cardBackPatternUrl})`,
        backgroundPosition: "center",
        backgroundSize: "cover",
        filter: props.invertColors ? "invert(1)" : undefined,
    } as CSSProperties;

    const baseFaceClasses =
        "flex h-full w-full items-start rounded-2xl border border-slate-900 bg-white bg-gradient-to-b from-slate-50 to-white px-3.5 py-3 text-left text-slate-900 outline-none dark:border-slate-900 dark:from-slate-50 dark:to-white dark:text-slate-900";
    const interactiveFaceClasses =
        "transition duration-200 hover:-translate-y-1 hover:border-slate-900 focus:-translate-y-1 focus:border-2 focus:border-sky-300 focus:outline-none focus:ring-0 focus:shadow-[0_0_0_3px_rgba(56,189,248,0.55)] focus-visible:-translate-y-1 focus-visible:border-2 focus-visible:border-sky-300 focus-visible:outline-none focus-visible:ring-0 focus-visible:shadow-[0_0_0_3px_rgba(56,189,248,0.55)] dark:hover:border-slate-900 dark:focus:border-sky-300 dark:focus-visible:border-sky-300";
    const nonInteractiveFaceClasses = "cursor-default";
    const winnerFaceClasses = "cards-ai-card-winner-face";
    const faceStyle = {
        color: "rgb(15 23 42)",
        filter: props.invertColors ? "invert(1)" : undefined,
    } as CSSProperties;

    const face = cardState.interactive ? (
        <button
            type="button"
            className={`${baseFaceClasses} ${interactiveFaceClasses} ${props.isWinner ? winnerFaceClasses : ""}`}
            style={faceStyle}
            onClick={props.onClick}
        >
            {props.children}
        </button>
    ) : (
        <div
            className={`${baseFaceClasses} ${nonInteractiveFaceClasses} ${props.isWinner ? winnerFaceClasses : ""}`}
            style={faceStyle}
        >
            {props.children}
        </div>
    );

    return (
        <div
            className={`cards-ai-card absolute left-0 top-0 h-[220px] w-[160px] [perspective:1200px]${props.isWinner ? " cards-ai-card-winner" : ""}`}
            style={cardStyle}
            onTransitionEnd={(event) => {
                if (event.target !== event.currentTarget) {
                    return;
                }
                if (event.propertyName !== "transform") {
                    return;
                }
                handleCardTransitionEnd(props.id);
            }}
        >
            <div className="cards-ai-card-inner relative h-full w-full">
                <div className="absolute inset-0 [backface-visibility:hidden]">
                    <div className="cards-ai-card-flight h-full w-full">
                        {face}
                    </div>
                </div>
                <div className="absolute inset-0 [transform:rotateY(180deg)] [backface-visibility:hidden]">
                    <div
                        className="cards-ai-card-flight h-full w-full rounded-2xl border border-white dark:border-white"
                        style={cardBackStyle}
                    />
                </div>
            </div>
        </div>
    );
}

interface CardManager {
    cards: Map<string, CardState>;
    layout: CardLayout;
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

const DEFAULT_CARD_LAYOUT: CardLayout = {
    playerPanels: {},
};

const reportErrorFn =
    typeof reportError === "function"
        ? reportError
        : (error: Error) => {
              setTimeout(() => {
                  throw error;
              });
          };

interface SetCardsStateAction {
    type: "SET_CARDS_STATE";
    cards: Map<string, CardState>;
    layout: CardLayout;
}

interface ApplyPendingCardsAction {
    type: "APPLY_PENDING_CARDS";
}

interface SyncWithGameStateAction {
    type: "SYNC_WITH_GAME_STATE";
    gameState: GameState;
    bounds: PlayAreaBounds;
    localPlayerId: string | null;
    seedEntering: boolean;
}

interface RemoveCardAction {
    type: "REMOVE_CARD";
    cardId: string;
}

interface FinalizeEnteringCardAction {
    type: "FINALIZE_ENTERING_CARD";
    cardId: string;
}

type CardAction =
    | SetCardsStateAction
    | ApplyPendingCardsAction
    | SyncWithGameStateAction
    | RemoveCardAction
    | FinalizeEnteringCardAction;

interface CardManagerState {
    cards: Map<string, CardState>;
    layout: CardLayout;
    pendingCards: Map<string, CardState> | null;
    pendingLayout: CardLayout | null;
    enteringTargets: Map<string, CardState>;
}

interface PlayAreaBounds {
    width: number;
    height: number;
}

const CARD_WIDTH = 160;
const CARD_HEIGHT = 220;
const CARD_GAP = 12;
const HAND_CORNER_PADDING = 34;
const LOCAL_HAND_GAP = 70;
const LOCAL_HAND_MIN_GAP = 18;
const LOCAL_HAND_ROTATION_STEP = 4;
const NON_LOCAL_CARD_GAP = 12;
const NON_LOCAL_GROUP_GAP = 28;
const PANEL_VERTICAL_GAP = 30;
const PANEL_HEIGHT = 36;
const PLAYED_ROW_GAP = 24;
const CARD_ENTER_FLIP_DELAY_MS = 850;
const DEALER_SPOT = {
    x: -CARD_WIDTH,
    y: -CARD_HEIGHT,
};

function getLocalPlayerIndex(gameState: GameState, localPlayerId: string | null) {
    if (localPlayerId && gameState.players.length > 0) {
        const localIndex = gameState.players.findIndex((player) => player.id === localPlayerId);
        if (localIndex >= 0) {
            return localIndex;
        }
    }
    return -1;
}

function buildCardStateMap(
    gameState: GameState,
    bounds: PlayAreaBounds,
    localPlayerId: string | null,
) {
    const cards: Record<string, CardState> = {};

    let promptY = bounds.height / 2 - CARD_HEIGHT / 2;
    if (gameState.prompt) {
        const promptX = (bounds.width - CARD_WIDTH) / 2;
        promptY = bounds.height / 2 - CARD_HEIGHT / 2;
        cards[gameState.prompt.id] = {
            x: promptX,
            y: promptY,
            rotation: 0,
            faceUp: true,
            interactive: false,
            status: "active",
        };
    }

    if (gameState.playedAnswerCards.length) {
        const playedRowY = gameState.prompt ? promptY + CARD_HEIGHT + PLAYED_ROW_GAP : promptY;
        const totalWidth =
            gameState.playedAnswerCards.length * CARD_WIDTH +
            (gameState.playedAnswerCards.length - 1) * CARD_GAP;
        const startX = (bounds.width - totalWidth) / 2;
        const y = playedRowY;
        for (let i = 0; i < gameState.playedAnswerCards.length; i += 1) {
            const played = gameState.playedAnswerCards[i];
            const x = startX + i * (CARD_WIDTH + CARD_GAP);
            const isLocalJudge =
                localPlayerId != null &&
                gameState.players[gameState.currentJudgePlayerIndex]?.id === localPlayerId;
            cards[played.cardId] = {
                x,
                y,
                rotation: (i - (gameState.playedAnswerCards.length - 1) / 2) * 2,
                faceUp: true,
                interactive: isLocalJudge && gameState.status === "judging",
                status: "active",
            };
        }
    }

    const localPlayerIndex = getLocalPlayerIndex(gameState, localPlayerId);
    const localPlayer =
        localPlayerIndex >= 0 ? gameState.players[localPlayerIndex] : null;

    const availableWidth = Math.max(0, bounds.width - HAND_CORNER_PADDING * 2);
    const localHandY = bounds.height - HAND_CORNER_PADDING - CARD_HEIGHT;
    const playerPanels: Record<string, { centerX: number; topY: number }> = {};

    if (localPlayer) {
        const isWaitingForAnswers = gameState.status === "waiting-for-answers";
        const localCardCount = localPlayer.answerCards.length;
        const maxGap =
            localCardCount > 1
                ? (availableWidth - CARD_WIDTH) / (localCardCount - 1)
                : 0;
        const localGap = Math.max(
            LOCAL_HAND_MIN_GAP,
            Math.min(LOCAL_HAND_GAP, maxGap),
        );
        const totalWidth =
            localCardCount > 0
                ? CARD_WIDTH + (localCardCount - 1) * localGap
                : CARD_WIDTH;
        const startX = (bounds.width - totalWidth) / 2;
        const midIndex = (localCardCount - 1) / 2;
        playerPanels[localPlayer.id] = {
            centerX: startX + totalWidth / 2,
            topY: localHandY,
        };

        for (let i = 0; i < localCardCount; i += 1) {
            const cardId = localPlayer.answerCards[i];
            const offset = i - midIndex;
            const x = startX + i * localGap;
            const y = localHandY;
            cards[cardId] = {
                x,
                y,
                rotation: offset * LOCAL_HAND_ROTATION_STEP,
                faceUp: true,
                interactive: isWaitingForAnswers,
                status: "active",
            };
        }
    }

    const nonLocalPlayers: NonLocalPlayerHand[] = [];
    for (let playerIndex = 0; playerIndex < gameState.players.length; playerIndex += 1) {
        if (playerIndex === localPlayerIndex) {
            continue;
        }
        const player = gameState.players[playerIndex];
        nonLocalPlayers.push({ player, cardCount: player.answerCards.length });
    }

    if (nonLocalPlayers.length > 0) {
        const minCardGap = 4;
        const minGroupGap = 8;
        let cardGap = NON_LOCAL_CARD_GAP;
        let groupGap = NON_LOCAL_GROUP_GAP;

        const calculateTotalWidth = (gap: number, group: number) => {
            let total = 0;
            for (let i = 0; i < nonLocalPlayers.length; i += 1) {
                const count = nonLocalPlayers[i].cardCount;
                const handWidth = count > 0 ? CARD_WIDTH + (count - 1) * gap : CARD_WIDTH;
                total += handWidth;
                if (i < nonLocalPlayers.length - 1) {
                    total += group;
                }
            }
            return total;
        };

        let totalWidth = calculateTotalWidth(cardGap, groupGap);
        if (totalWidth > availableWidth && totalWidth > 0) {
            const shrinkRatio = availableWidth / totalWidth;
            cardGap = Math.max(minCardGap, cardGap * shrinkRatio);
            groupGap = Math.max(minGroupGap, groupGap * shrinkRatio);
            totalWidth = calculateTotalWidth(cardGap, groupGap);
        }
        if (totalWidth > availableWidth) {
            cardGap = minCardGap;
            groupGap = minGroupGap;
            totalWidth = calculateTotalWidth(cardGap, groupGap);
        }

        let currentX = (bounds.width - totalWidth) / 2;
        const topRowY = HAND_CORNER_PADDING + PANEL_HEIGHT + PANEL_VERTICAL_GAP;

        for (let i = 0; i < nonLocalPlayers.length; i += 1) {
            const { player, cardCount } = nonLocalPlayers[i];
            const midIndex = (cardCount - 1) / 2;
            for (let cardIndex = 0; cardIndex < cardCount; cardIndex += 1) {
                const cardId = player.answerCards[cardIndex];
                const offset = cardIndex - midIndex;
                const x = currentX + cardIndex * cardGap;
                const y = topRowY;
                cards[cardId] = {
                    x,
                    y,
                    rotation: offset * 1.2,
                    faceUp: false,
                    interactive: false,
                    status: "active",
                };
            }
            const handWidth = cardCount > 0 ? CARD_WIDTH + (cardCount - 1) * cardGap : CARD_WIDTH;
            playerPanels[player.id] = {
                centerX: currentX + handWidth / 2,
                topY: topRowY,
            };
            currentX += handWidth + groupGap;
        }
    }

    return {
        cards,
        layout: {
            playerPanels,
        },
    };
}

function createEnteringState(cardState: CardState): CardState {
    return {
        ...cardState,
        faceUp: false,
        interactive: false,
        status: "entering",
    };
}

export const CardManagementContext = createContext<CardManager | null>(null);

/**
 * A CardManagementProvider that provides the card management context to its children.
 * This allows for the management of the position and state of cards in the game using the
 * {@link useCardState} and {@link useCardManagement} hooks.
 * @param children - The children of the CardManagementProvider.
 * @returns A CardManagementProvider that provides the card management context to its children.
 */
export function CardManagementProvider({ children }: { children: React.ReactNode }) {
    const { localPlayerId } = useGameManagement();
    const gameState = useGameState();
    const [state, reducer] = useReducer(
        (state: CardManagerState, action: CardAction): CardManagerState => {
            switch (action.type) {
                case "SET_CARDS_STATE":
                    return {
                        ...state,
                        cards: action.cards,
                        layout: action.layout,
                        pendingCards: null,
                        pendingLayout: null,
                        enteringTargets: new Map(),
                    };
                case "SYNC_WITH_GAME_STATE": {
                    const nextLayout = buildCardStateMap(action.gameState, action.bounds, action.localPlayerId);
                    const finalCards = new Map<string, CardState>();
                    const nextEnteringTargets = new Map<string, CardState>();
                    const enteringCardIds: string[] = [];
                    const discardedCardIds = new Set<string>([
                        ...action.gameState.discardedAnswerCards,
                        ...action.gameState.discardedPromptCards.map((promptCard) => promptCard.id),
                    ]);

                    for (const [cardId, cardState] of Object.entries(nextLayout.cards)) {
                        const existingCard = state.cards.get(cardId);
                        const targetCard: CardState = {
                            ...cardState,
                            status: "active",
                        };
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

                    for (const [cardId, cardState] of state.cards) {
                        if (finalCards.has(cardId)) {
                            continue;
                        }
                        if (!discardedCardIds.has(cardId)) {
                            continue;
                        }
                        finalCards.set(cardId, {
                            ...cardState,
                            x: DEALER_SPOT.x,
                            y: DEALER_SPOT.y,
                            interactive: false,
                            status: "exiting",
                        });
                    }

                    if (action.seedEntering && enteringCardIds.length > 0) {
                        const seededCards = new Map(finalCards);
                        for (const cardId of enteringCardIds) {
                            const targetCard = finalCards.get(cardId);
                            if (!targetCard) {
                                continue;
                            }
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
                            layout: nextLayout.layout,
                            pendingCards: finalCards,
                            pendingLayout: nextLayout.layout,
                            enteringTargets: nextEnteringTargets,
                        };
                    }

                    return {
                        ...state,
                        cards: finalCards,
                        layout: nextLayout.layout,
                        pendingCards: null,
                        pendingLayout: null,
                        enteringTargets: nextEnteringTargets,
                    };
                }
                case "APPLY_PENDING_CARDS":
                    if (!state.pendingCards || !state.pendingLayout) {
                        return state;
                    }
                    return {
                        ...state,
                        cards: state.pendingCards,
                        layout: state.pendingLayout,
                        pendingCards: null,
                        pendingLayout: null,
                    };
                case "FINALIZE_ENTERING_CARD": {
                    const targetCard = state.enteringTargets.get(action.cardId);
                    if (!targetCard) {
                        return state;
                    }
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
                    if (!state.cards.has(action.cardId)) {
                        return state;
                    }
                    const nextCards = new Map(state.cards);
                    nextCards.delete(action.cardId);
                    const nextPendingCards = state.pendingCards ? new Map(state.pendingCards) : null;
                    if (nextPendingCards?.has(action.cardId)) {
                        nextPendingCards.delete(action.cardId);
                    }
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
        },
        {
            cards: new Map<string, CardState>(),
            layout: DEFAULT_CARD_LAYOUT,
            pendingCards: null,
            pendingLayout: null,
            enteringTargets: new Map(),
        },
    );
    const playAreaRef = useRef<HTMLDivElement | null>(null);
    const lastBoundsRef = useRef<PlayAreaBounds | null>(null);
    const enteringTimeoutsRef = useRef<Map<string, number>>(new Map());

    const getPlayAreaBounds = useCallback(() => {
        const container = playAreaRef.current;
        if (!container) {
            return null;
        }
        const containerRect = container.getBoundingClientRect();
        if (!containerRect.width || !containerRect.height) {
            return null;
        }
        const bounds = {
            width: containerRect.width,
            height: containerRect.height,
        };
        return bounds;
    }, []);

    useEffect(() => {
        const bounds = getPlayAreaBounds();
        if (!bounds) {
            return;
        }
        reducer({
            type: "SYNC_WITH_GAME_STATE",
            gameState,
            bounds,
            localPlayerId,
            seedEntering: true,
        });
    }, [gameState, getPlayAreaBounds, localPlayerId]);

    const getCardState = useCallback(
        (cardId: string) => {
            const cardState = state.cards.get(cardId);
            if (!cardState) {
                reportErrorFn(new Error(`Card ${cardId} not found`));
                return DEFAULT_CARD_STATE;
            }
            return cardState;
        },
        [state.cards],
    );

    useEffect(() => {
        const container = playAreaRef.current;
        if (!container || typeof ResizeObserver === "undefined") {
            return;
        }

        const handleResize = () => {
            const nextBounds = getPlayAreaBounds();
            if (!nextBounds) {
                return;
            }
            const lastBounds = lastBoundsRef.current;
            if (lastBounds && lastBounds.width === nextBounds.width && lastBounds.height === nextBounds.height) {
                return;
            }
            lastBoundsRef.current = nextBounds;
            reducer({
                type: "SYNC_WITH_GAME_STATE",
                gameState,
                bounds: nextBounds,
                localPlayerId,
                seedEntering: false,
            });
        };

        const observer = new ResizeObserver(handleResize);
        observer.observe(container);
        handleResize();

        return () => {
            observer.disconnect();
        };
    }, [gameState, getPlayAreaBounds, localPlayerId]);

    useEffect(() => {
        if (!state.pendingCards || !state.pendingLayout) {
            return;
        }
        // Apply pending positions after paint so CSS transitions run from (0,0).
        reducer({ type: "APPLY_PENDING_CARDS" });
    }, [state.pendingCards, state.pendingLayout]);

    useEffect(() => {
        return () => {
            for (const timeoutId of enteringTimeoutsRef.current.values()) {
                clearTimeout(timeoutId);
            }
            enteringTimeoutsRef.current.clear();
        };
    }, []);

    useEffect(() => {
        // Schedule a one-time flip completion for entering cards and clean up any stale timers.
        const activeCardIds = new Set<string>();
        for (const cardId of state.cards.keys()) {
            activeCardIds.add(cardId);
        }

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
                    const timeoutId = enteringTimeoutsRef.current.get(cardId);
                    if (timeoutId != null) {
                        clearTimeout(timeoutId);
                    }
                    enteringTimeoutsRef.current.delete(cardId);
                }
                continue;
            }
            if (hasTimeout) {
                continue;
            }
            const timeoutId = window.setTimeout(() => {
                reducer({ type: "FINALIZE_ENTERING_CARD", cardId });
            }, CARD_ENTER_FLIP_DELAY_MS);
            enteringTimeoutsRef.current.set(cardId, timeoutId);
        }
    }, [state.cards]);

    const handleCardTransitionEnd = useCallback(
        (cardId: string) => {
            const cardState = state.cards.get(cardId);
            if (!cardState) {
                return;
            }
            if (cardState.status === "exiting") {
                reducer({ type: "REMOVE_CARD", cardId });
                return;
            }
            if (cardState.status === "entering") {
                reducer({ type: "FINALIZE_ENTERING_CARD", cardId });
            }
        },
        [state.cards],
    );

    const cardManager = useMemo(
        () => ({
            cards: state.cards,
            layout: state.layout,
            getCardState,
            handleCardTransitionEnd,
        }),
        [getCardState, handleCardTransitionEnd, state.cards, state.layout],
    );
    
    return (
        <CardManagementContext.Provider value={cardManager}>
            <div className="flex h-full w-full flex-col gap-4">
                <div
                    ref={playAreaRef}
                    className="relative min-h-[640px] flex-1 overflow-hidden rounded-3xl border p-4 shadow-inner"
                >
                    {children}
                </div>
            </div>
        </CardManagementContext.Provider>
    );
}

export function useCardManagement() {
    const cardManager = useContext(CardManagementContext);

    if (!cardManager) {
        throw new Error('CardManagementContext not found');
    }

    return cardManager;
}

export function useCardState(cardId: string) {
    const { getCardState } = useCardManagement();

    return useMemo(() => getCardState(cardId), [cardId, getCardState]);
}