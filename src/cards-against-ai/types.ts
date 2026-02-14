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

export interface Persona {
  id: string;
  name: string;
  personality: string;
  likes: string[];
  dislikes: string[];
  humorStyle: string[];
  favoriteJokeTypes: string[];
  catchphrase?: string;
  quirks?: string[];
  backstory?: string;
  voiceTone?: string;
  competitiveness?: number;
}

export interface Player {
  id: string;
  type: "human" | "cpu";
  persona: Persona | null;
  wonPromptCards: PromptCard[];
  answerCards: string[];
}

export interface PlayedAnswerCard {
  cardId: string;
  playerId: string;
  playerComment?: string;
}

export type GameStatus =
  | "initializing"
  | "waiting-for-answers"
  | "judging"
  | "game-ended"
  | "display-judgement"
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

export type NextActionHint = {
  action: string;
  description: string;
  /** When true, widget should sendMessage after callServerTool so the model acts next */
  notifyModel: boolean;
} | null;

export interface ChatMessage {
  playerId: string;
  playerName: string;
  message: string;
}

export interface IntroDialogEntry {
  playerId: string;
  playerName: string;
  dialog: string;
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
  discardedPromptCards: PromptCard[];
  judgementResult: JudgementResult | null;
  chatLog: ChatMessage[];
}
