import { createFakeAnswerDeck } from "./fetchAnswerDeck";
import { createFakePlayers } from "./fetchPlayers";
import { AnswerCard, GameState } from "./types";



export async function fetchGameState(): Promise<GameState> {
    throw new Error("Not implemented");   
}

export async function fetchFakeGameState(): Promise<GameState> {
    const answerDeck = createFakeAnswerDeck();
    const answerCards: Record<string, AnswerCard> = {};
    for (const card of answerDeck) {
        answerCards[card.id] = card;
    }
    return {
        gameKey: "local",
        prompt: null,
        playedAnswerCards: [],
        players: createFakePlayers(),
        status: "waiting-for-players",
        winnerId: null,
        currentJudgePlayerIndex: 0,
        answerCards,
        answerDeck: answerDeck.map((card) => card.id),
        discardedAnswerCards: [],
        discardedPromptCards: [],
        judgementResult: null,
        outcomeReactions: [],
    }
}