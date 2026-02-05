import { createFakeAnswerDeck } from "./fetchAnswerDeck";
import { createFakePlayers } from "./fetchPlayers";
import { AnswerCard, GameState, PromptCard } from "./types";

const TARGET_HAND_SIZE = 7;

function buildBaseState(): {
  state: GameState;
  allCards: AnswerCard[];
} {
  const players = createFakePlayers();
  const allCards = createFakeAnswerDeck();
  const answerCards: Record<string, AnswerCard> = {};
  for (const card of allCards) {
    answerCards[card.id] = card;
  }

  const deck = allCards.map((c) => c.id);
  // Deal hands to all players
  for (const player of players) {
    while (player.answerCards.length < TARGET_HAND_SIZE && deck.length > 0) {
      player.answerCards.push(deck.shift()!);
    }
  }

  const prompt: PromptCard = {
    id: "prompt-dev",
    type: "prompt",
    text: "When I was a kid, I used to think ____ was the meaning of life.",
  };

  return {
    allCards,
    state: {
      gameKey: "dev-local",
      prompt,
      playedAnswerCards: [],
      players,
      status: "waiting-for-answers",
      winnerId: null,
      currentJudgePlayerIndex: 0,
      answerCards,
      answerDeck: deck,
      discardedAnswerCards: [],
      discardedPromptCards: [],
      judgementResult: null,
    },
  };
}

/** Player's hand is visible, waiting for them to play a card */
function handScenario(): GameState {
  const { state } = buildBaseState();
  // Make a CPU player the judge so the local player sees their hand
  state.currentJudgePlayerIndex = 1;
  return state;
}

/** Local player is the judge, waiting for answers */
function waitingScenario(): GameState {
  const { state } = buildBaseState();
  // Make player-001 (local) the judge
  state.currentJudgePlayerIndex = 0;
  return state;
}

/** Judging: all CPU players have played cards, local player is judge */
function judgingScenario(): GameState {
  const { state } = buildBaseState();
  state.status = "judging";
  state.currentJudgePlayerIndex = 0; // local player is judge

  // CPU players (index 1-4) each play a card
  for (let i = 1; i < state.players.length; i++) {
    const player = state.players[i];
    const cardId = player.answerCards[0];
    state.playedAnswerCards.push({
      cardId,
      playerId: player.id,
      playerComment: `I think this is hilarious! - ${player.persona?.name}`,
    });
    player.answerCards = player.answerCards.slice(1);
  }

  return state;
}

/** Display judgement: winner glow animation visible */
function judgementScenario(): GameState {
  const state = judgingScenario();
  state.status = "display-judgement";

  const winningPlayed = state.playedAnswerCards[1]; // second card wins
  const winningPlayer = state.players.find(
    (p) => p.id === winningPlayed.playerId,
  )!;

  // Give the winner a won prompt card
  winningPlayer.wonPromptCards.push(state.prompt!);

  state.judgementResult = {
    judgeId: state.players[0].id,
    winningCardId: winningPlayed.cardId,
    winningPlayerId: winningPlayed.playerId,
    reactionToWinningCard:
      "Oh my god, that is PERFECT. I can't stop laughing!",
  };

  return state;
}

/** Scoreboard with various win counts */
function scoreboardScenario(): GameState {
  const { state } = buildBaseState();
  state.status = "waiting-for-answers";

  // Give players different win counts
  const fakePrompt = (n: number): PromptCard => ({
    id: `prompt-fake-${n}`,
    type: "prompt",
    text: `Fake prompt ${n}`,
  });

  state.players[0].wonPromptCards = []; // 0 wins (local)
  state.players[1].wonPromptCards = [fakePrompt(1), fakePrompt(2), fakePrompt(3)]; // 3 wins
  state.players[2].wonPromptCards = [fakePrompt(4)]; // 1 win
  state.players[3].wonPromptCards = [fakePrompt(5), fakePrompt(6)]; // 2 wins
  state.players[4].wonPromptCards = [fakePrompt(7), fakePrompt(8), fakePrompt(9), fakePrompt(10)]; // 4 wins

  return state;
}

export type DevScenarioName =
  | "hand"
  | "waiting"
  | "judging"
  | "judgement"
  | "scoreboard";

const SCENARIOS: Record<DevScenarioName, () => GameState> = {
  hand: handScenario,
  waiting: waitingScenario,
  judging: judgingScenario,
  judgement: judgementScenario,
  scoreboard: scoreboardScenario,
};

export const DEV_SCENARIO_NAMES = Object.keys(SCENARIOS) as DevScenarioName[];

export function getDevScenario(name: string): GameState | null {
  const factory = SCENARIOS[name as DevScenarioName];
  return factory ? factory() : null;
}
