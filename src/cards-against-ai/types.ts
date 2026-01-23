export interface AnswerCard {
  id: string;
  type: "answer";
  text: string;
}

export interface PromptCard {
  id: string;
  type: "prompt";
  text: string;
}

export type PlayingCard = AnswerCard | PromptCard;

export interface Persona {
  id: string;
  name: string;
  personality: string;
  likes: string[];
  dislikes: string[];
  humorStyle: string[];
  favoriteJokeTypes: string[];
}

export interface Player {
  id: string;
  type: "human" | "cpu" | "vacant";
  persona: Persona | null;
  wonPromptCards: PromptCard[];
  answerCards: string[];
}

export interface PlayedAnswerCard {
  cardId: string;
  playerId: string;
  playerComment?: string;
}

export interface OutcomeReaction {
  playerId: string;
  reaction: string;
}

export type GameStatus =
  | "initializing"
  | "waiting-for-players"
  | "dealing"
  | "waiting-for-answers"
  | "judging"
  | "game-ended"
  | "display-judgement"
  | "clearing-played-cards"
  | "prepare-for-next-round"
  | "announce-winner";

export interface JudgementResult {
  judgeId: string;
  /** The ID of the winning card. */
  winningCardId: string;
  /** The ID of the player who won the round. */
  winningPlayerId: string;
  /** An explanation of why the judge chose the winning card. */
  reactionToWinningCard?: string;
}

export interface GameState {
  gameKey: string;
  prompt: PromptCard | null;
  playedAnswerCards: PlayedAnswerCard[];
  players: Player[];
  status: GameStatus;
  winnerId: string | null;
  currentJudgePlayerIndex: number;
  answerCards: Record<string, AnswerCard>;
  answerDeck: string[];
  discardedAnswerCards: string[];
  discardedPromptCards: PromptCard[];
  judgementResult: JudgementResult | null;
  outcomeReactions: OutcomeReaction[];
}
