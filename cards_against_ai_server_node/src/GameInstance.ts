import EventEmitter from "node:events";
import {
  AnswerCard,
  GameState,
  JudgementResult,
  Persona,
  Player,
  PromptCard,
} from "./shared-types.js";

interface InitializeNewGameAction {
  type: "INITIALIZE_NEW_GAME";
  owner: { id: string; persona: Persona };
  otherPlayers: (CpuPlayer | HumanPlayer)[];
  answerDeck: AnswerCard[];
}

interface WaitingForPlayersAction {
  type: "WAITING_FOR_PLAYERS";
}

interface PlayerJoinedAction {
  type: "PLAYER_JOINED";
  player: { id: string; persona: Persona };
}

interface DealCardsAction {
  type: "DEAL_CARDS";
}

interface WaitingForAnswersAction {
  type: "WAITING_FOR_ANSWERS";
}

interface JudgingAction {
  type: "JUDGING";
}

interface AnnounceWinnerAction {
  type: "ANNOUNCE_WINNER";
  winnerId: string;
}

interface ReturnJudgementAction {
  type: "RETURN_JUDGEMENT";
  result: {
    /** The ID of the player who judged the round. */
    judgeId: string;
    /** The ID of the winning card. */
    winningCardId: string;
    /** The ID of the player who won the round. */
    winningPlayerId: string;
    /** An explanation of why the judge chose the winning card. */
    reactionToWinningCard?: string;
  };
}

interface RequestPromptAction {
  type: "GET_PROMPT";
}

interface PromptReceivedAction {
  type: "PROMPT_RECEIVED";
  prompt: PromptCard;
}

interface PrepareForNextRoundAction {
  type: "PREPARE_FOR_NEXT_ROUND";
}

interface ReadyForNextRoundAction {
  type: "READY_FOR_NEXT_ROUND";
}

interface PlayerPlayedAnswerCardAction {
  type: "PLAYER_PLAYED_ANSWER_CARD";
  playerId: string;
  cardId: string;
  playerComment?: string;
}

interface SetOutcomeReactionsAction {
  type: "SET_OUTCOME_REACTIONS";
  reactions: CpuOutcomeReactions;
}

type GameAction =
  | InitializeNewGameAction
  | WaitingForPlayersAction
  | PlayerJoinedAction
  | DealCardsAction
  | WaitingForAnswersAction
  | JudgingAction
  | ReturnJudgementAction
  | RequestPromptAction
  | PromptReceivedAction
  | PrepareForNextRoundAction
  | ReadyForNextRoundAction
  | AnnounceWinnerAction
  | PlayerPlayedAnswerCardAction
  | SetOutcomeReactionsAction;

interface CpuPlayer {
  type: "cpu";
  persona: Persona;
}
interface HumanPlayer {
  type: "human";
}

interface GameInstanceOptions {
  owner: { id: string; persona: Persona };
  otherPlayers: (CpuPlayer | HumanPlayer)[];
  answerDeck: AnswerCard[];
}

const ANSWER_HAND_SIZE = 7;

export class GameInstance extends EventEmitter {
  /** A unique key for the game instance. This can be used later to join the game. */
  readonly key = generateKey();
  private readonly options: GameInstanceOptions;

  private state: GameState = {
    gameKey: this.key,
    prompt: null,
    playedAnswerCards: [],
    players: [],
    status: "waiting-for-players",
    currentJudgePlayerIndex: 0,
    answerCards: {},
    answerDeck: [],
    discardedAnswerCards: [],
    discardedPromptCards: [],
    judgementResult: null,
    outcomeReactions: [],
    winnerId: null,
  };
  private lastEmittedState: GameState = this.state;
  private isRequestingCpuAnswers = false;
  private isRequestingPrompt = false;

  constructor(options: GameInstanceOptions) {
    super();
    this.options = options;
  }

  getState() {
    return this.lastEmittedState;
  }

  getNonJudgeHandTexts(): string[] {
    const judge = this.state.players[this.state.currentJudgePlayerIndex] ?? null;
    const texts: string[] = [];

    for (const player of this.state.players) {
      if (player.type === "vacant" || player.id === judge?.id) {
        continue;
      }
      for (const cardId of player.answerCards) {
        const card = this.state.answerCards[cardId];
        if (card) {
          texts.push(card.text);
        }
      }
    }

    return texts;
  }

  initializeNewGame() {
    this.dispatchAction({
      type: "INITIALIZE_NEW_GAME",
      owner: this.options.owner,
      otherPlayers: this.options.otherPlayers,
      answerDeck: this.options.answerDeck,
    });
  }

  hasVacancy() {
    return this.state.players.some((player) => player.type === "vacant");
  }

  joinPlayer(player: { id: string; persona: Persona }) {
    if (!this.hasVacancy()) {
      return false;
    }

    this.dispatchAction({ type: "PLAYER_JOINED", player });
    return true;
  }

  playAnswerCard(playerId: string, cardId: string, playerComment?: string) {
    const player = this.state.players.find((entry) => entry.id === playerId);
    if (!player) {
      throw new Error(`Player ${playerId} not found`);
    }
    const judge = this.state.players[this.state.currentJudgePlayerIndex];
    if (judge?.id === playerId) {
      throw new Error(`Judge ${playerId} cannot play an answer card`);
    }
    if (this.state.status !== "waiting-for-answers") {
      throw new Error(
        `Cannot play answer card while game is ${this.state.status}`,
      );
    }
    if (
      this.state.playedAnswerCards.some(
        (played) => played.playerId === playerId,
      )
    ) {
      throw new Error(`Player ${playerId} has already played a card`);
    }
    if (!player.answerCards.includes(cardId)) {
      throw new Error(
        `Player ${playerId} does not have this card in their hand`,
      );
    }

    this.dispatchAction({
      type: "PLAYER_PLAYED_ANSWER_CARD",
      playerId,
      cardId,
      playerComment,
    });
  }

  private reducer(prevState: GameState, action: GameAction): GameState {
    switch (action.type) {
      case "INITIALIZE_NEW_GAME": {
        const answerCards: Record<string, AnswerCard> = {};
        for (const card of action.answerDeck) {
          answerCards[card.id] = card;
        }
        const cpuPlayers = action.otherPlayers.filter(
          (player): player is CpuPlayer => player.type === "cpu",
        );
        const humanPlayers = action.otherPlayers.filter(
          (player): player is HumanPlayer => player.type === "human",
        );
        const players: Player[] = [
          // Start with the owner as the first player
          {
            id: action.owner.id,
            type: "human",
            persona: action.owner.persona,
            wonPromptCards: [],
            answerCards: [],
          },
          // Then add the human players as vacant players
          ...humanPlayers.map(() => ({
            id: "",
            type: "vacant" as const,
            persona: null,
            wonPromptCards: [],
            answerCards: [],
          })),
          // Then add the CPU players as CPU players
          ...cpuPlayers.map((player) => ({
            id: crypto.randomUUID(),
            type: "cpu" as const,
            persona: player.persona,
            wonPromptCards: [],
            answerCards: [],
          })),
        ];
        return {
          ...prevState,
          status: "initializing",
          players,
          answerCards,
          answerDeck: Array.from(
            fisherYatesShuffle(action.answerDeck.map((card) => card.id)),
          ),
        };
      }
      case "WAITING_FOR_PLAYERS": {
        return {
          ...prevState,
          status: "waiting-for-players",
        };
      }
      case "PLAYER_JOINED": {
        // Add the new player to the players array
        // Find the first vacant player, and replace it with a new player,
        // but the vacant player already has cards, so keep those.
        let assigned = false;
        return {
          ...prevState,
          players: prevState.players.map((player) => {
            if (!assigned && player.type === "vacant") {
              assigned = true;
              return {
                ...player,
                id: action.player.id,
                type: "human",
                persona: action.player.persona,
              };
            }

            return player;
          }),
        };
      }
      case "DEAL_CARDS": {
        // Here we remove the cards from the top of the answerDeck, one at a time, and provide it to each player
        // until each player has the target hand size of answer cards.
        const players = Array.from(prevState.players);
        let answerDeck = [...prevState.answerDeck];
        let discardedAnswerCards = [...prevState.discardedAnswerCards];

        let i = 0;
        while (
          players.some((player) => player.answerCards.length < ANSWER_HAND_SIZE)
        ) {
          const playerIndex = i % players.length;
          const player = players[playerIndex];
          if (player.answerCards.length < ANSWER_HAND_SIZE) {
            let nextCardId = answerDeck.shift();
            if (!nextCardId) {
              // TODO: Shuffle discarded cards and move them to the answerDeck
              answerDeck = Array.from(fisherYatesShuffle(discardedAnswerCards));
              discardedAnswerCards = [];
              nextCardId = answerDeck.shift()!;
            }
            players[playerIndex] = {
              ...player,
              answerCards: [...player.answerCards, nextCardId],
            };
          }
          i++;
        }

        return {
          ...prevState,
          players,
          answerDeck,
          discardedAnswerCards,
          status: prevState.prompt ? "waiting-for-answers" : "dealing",
        };
      }
      case "WAITING_FOR_ANSWERS": {
        return {
          ...prevState,
          status: "waiting-for-answers",
        };
      }
      case "GET_PROMPT": {
        return {
          ...prevState,
          status: "dealing",
        };
      }
      case "JUDGING": {
        return {
          ...prevState,
          status: "judging",
        };
      }
      case "RETURN_JUDGEMENT": {
        const prompt = prevState.prompt;
        const winningPlayerId = action.result.winningPlayerId;
        const players = prompt
          ? prevState.players.map((player) => {
              if (player.id === winningPlayerId) {
                return {
                  ...player,
                  wonPromptCards: Array.from(new Set([...player.wonPromptCards, prompt])),
                };
              } 
              return player;
            })
          : prevState.players;
        return {
          ...prevState,
          status: "display-judgement",
          judgementResult: action.result,
          outcomeReactions: [],
          players,
        };
      }
      case "PREPARE_FOR_NEXT_ROUND": {
        // Move the played answer cards to the discarded answer cards
        // Clear the prompt
        // Clear the judgement result
        // Move to the next judge player
        const discardedPromptCards = prevState.prompt
          ? [...prevState.discardedPromptCards, prevState.prompt]
          : prevState.discardedPromptCards;
        return {
          ...prevState,
          status: "prepare-for-next-round",
          playedAnswerCards: [],
          discardedAnswerCards: [
            ...prevState.discardedAnswerCards,
            ...prevState.playedAnswerCards.map((played) => played.cardId),
          ],
          discardedPromptCards,
          prompt: null,
          judgementResult: null,
          outcomeReactions: [],
          currentJudgePlayerIndex:
            (prevState.currentJudgePlayerIndex + 1) % prevState.players.length,
        };
      }
      case "ANNOUNCE_WINNER": {
        return {
          ...prevState,
          status: "announce-winner",
          winnerId: action.winnerId,
        };
      }
      case "PROMPT_RECEIVED": {
        const discardedPromptCards = prevState.prompt
          ? [...prevState.discardedPromptCards, prevState.prompt]
          : prevState.discardedPromptCards;
        return {
          ...prevState,
          status: "waiting-for-answers",
          prompt: action.prompt,
          playedAnswerCards: [],
          discardedPromptCards,
        };
      }
      case "PLAYER_PLAYED_ANSWER_CARD": {
        return {
          ...prevState,
          playedAnswerCards: [
            ...prevState.playedAnswerCards,
            {
              playerId: action.playerId,
              cardId: action.cardId,
              playerComment: action.playerComment,
            },
          ],
          players: prevState.players.map((player) =>
            player.id === action.playerId
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
      case "SET_OUTCOME_REACTIONS": {
        return {
          ...prevState,
          outcomeReactions: action.reactions,
        };
      }
      default: {
        return prevState;
      }
    }
  }

  private dispatchAction(action: GameAction) {
    this.state = this.reducer(this.state, action);
    this.lastEmittedState = this.state;
    this.emit("state-changed", this.state);
    this.effects(action);
  }

  private async effects(action: GameAction) {
    switch (action.type) {
      case "INITIALIZE_NEW_GAME": {
        if (this.state.players.some((player) => player.type === "vacant")) {
          this.waitForPlayers();
        } else {
          // Give the players time to notice the game is ready.
          await sleep(1000);
          this.dealCards();
        }
        return;
      }
      case "DEAL_CARDS": {
        await this.requestPromptIfNeeded();
        return;
      }
      case "PLAYER_JOINED": {
        if (this.state.players.every((player) => player.type !== "vacant")) {
          // Give the players time to notice the new player
          await sleep(1000);
          this.dealCards();
        }
        return;
      }
      case "PREPARE_FOR_NEXT_ROUND": {
        await sleep(1000);
        this.dealCards();
        return;
      }
      case "RETURN_JUDGEMENT": {
        const reactions = await this.requestCpuOutcomeReactions(action.result);
        if (reactions && reactions.length > 0) {
          this.dispatchAction({
            type: "SET_OUTCOME_REACTIONS",
            reactions,
          });
        }
        // Give the players time to notice the judgement
        await sleep(4000);
        this.prepareForNextRound();
        return;
      }
      case "PLAYER_PLAYED_ANSWER_CARD": {
        if (this.state.playedAnswerCards.length === this.getExpectedAnswerCount()) {
          // Give the players time to notice the answer cards have been played
          await sleep(1000);
          await this.judgeRound();
        }
        return;
      }
      case "PROMPT_RECEIVED": {
        await this.requestCpuAnswersIfNeeded();
        return;
      }
    }
  }

  private prepareForNextRound() {
    this.dispatchAction({ type: "PREPARE_FOR_NEXT_ROUND" });
  }

  private waitForPlayers() {
    this.dispatchAction({ type: "WAITING_FOR_PLAYERS" });
  }

  private dealCards() {
    this.dispatchAction({ type: "DEAL_CARDS" });
  }

  private async judgeRound() {
    this.dispatchAction({ type: "JUDGING" });
    const judge = this.state.players[this.state.currentJudgePlayerIndex];

    // If the judge is a CPU player, call the AI to judge the round
    // If the judge is a human player, we just wait for them to judge
    if (judge.type === "cpu") {
      const prompt = this.state.prompt;
      if (!prompt) {
        console.warn("Missing prompt for CPU judgement");
        return;
      }

      const playedAnswerCards = this.state.playedAnswerCards;
      if (!playedAnswerCards.length) {
        console.warn("No played answer cards available for CPU judgement");
        return;
      }

      const judgement = await requestCpuJudgement({
        prompt,
        judge,
        playedAnswerCards,
        answerCards: this.state.answerCards,
        players: this.state.players,
      });

      let winningCardId = judgement?.winningCardId ?? null;
      if (!winningCardId || !findPlayedAnswerCard(playedAnswerCards, winningCardId)) {
        winningCardId = pickRandomPlayedCardId(playedAnswerCards);
      }

      if (!winningCardId) {
        console.warn("CPU judgement returned no valid winning card");
        return;
      }

      const winningEntry = findPlayedAnswerCard(playedAnswerCards, winningCardId);
      if (!winningEntry) {
        console.warn("CPU judgement winning card not found in played answers", {
          winningCardId,
        });
        return;
      }

      const reaction = sanitizeCpuReaction(
        judgement?.reactionToWinningCard,
        judge.persona?.name,
      );
      this.judgeAnswers({
        judgeId: judge.id,
        winningCardId,
        winningPlayerId: winningEntry.playerId,
        reactionToWinningCard: reaction,
      });
    }
  }

  private getExpectedAnswerCount() {
    const judge = this.state.players[this.state.currentJudgePlayerIndex];
    return this.state.players.reduce((count, player) => {
      if (player.type !== "vacant" && player.id !== judge?.id) {
        return count + 1;
      }
      return count;
    }, 0);
  }

  private async requestCpuAnswersIfNeeded() {
    if (this.isRequestingCpuAnswers || this.state.status !== "waiting-for-answers" || !this.state.prompt) {
      return;
    }

    const judge = this.state.players[this.state.currentJudgePlayerIndex];
    const cpuPlayers = this.state.players.filter(
      (player) => player.type === "cpu" && player.id !== judge?.id,
    );

    if (cpuPlayers.length === 0) {
      return;
    }

    this.isRequestingCpuAnswers = true;
    try {
      let choices: CpuAnswerCardChoices = [];
      try {
        choices = await requestCpuAnswerChoices({
          prompt: this.state.prompt,
          cpuPlayers,
          answerCards: this.state.answerCards,
        });
      } catch (error) {
        console.warn(
          "[cards-ai] CPU answer choice request failed; using fallbacks",
          error instanceof Error ? error.message : error,
        );
      }

      const choicesByPlayerId = new Map<string, CpuAnswerChoice>();
      for (const choice of choices) {
        choicesByPlayerId.set(choice.playerId, choice);
      }

      for (const player of cpuPlayers) {
        if (this.state.playedAnswerCards.some((played) => played.playerId === player.id)) {
          continue;
        }

        const choice = choicesByPlayerId.get(player.id);
        let cardIdToPlay: string | null = choice?.cardId ?? null;

        if (!cardIdToPlay) {
          console.warn("CPU answer choice has no card to play", player.id);
          cardIdToPlay = pickRandomAnswerCardId(player.answerCards);
        }

        const comment = sanitizeCpuComment(choice?.playerComment, player.persona?.name);
        this.playAnswerCard(player.id, cardIdToPlay!, comment);
      }
    } finally {
      this.isRequestingCpuAnswers = false;
    }
  }

  private async requestCpuOutcomeReactions(result: JudgementResult) {
    const prompt = this.state.prompt;
    if (!prompt) {
      return;
    }

    const winningCard = this.state.answerCards[result.winningCardId];
    if (!winningCard) {
      console.warn("Missing winning card for CPU reactions", result.winningCardId);
      return;
    }

    const judge = this.state.players.find((player) => player.id === result.judgeId);
    if (!judge) {
      console.warn("Missing judge for CPU reactions", result.judgeId);
      return;
    }

    const winner = this.state.players.find(
      (player) => player.id === result.winningPlayerId,
    );
    if (!winner) {
      console.warn("Missing winner for CPU reactions", result.winningPlayerId);
      return;
    }

    const cpuPlayers = this.state.players.filter(
      (player) => player.type === "cpu",
    );
    if (cpuPlayers.length === 0) {
      return;
    }

    try {
      const rawReactions = await requestCpuOutcomeReactions({
        prompt,
        winningCard,
        judge,
        winner,
        cpuPlayers,
      });

      const knownPlayerIds = new Set<string>();
      const playerIdsByName = new Map<string, string>();
      for (const player of cpuPlayers) {
        knownPlayerIds.add(player.id);
        const personaName = player.persona?.name?.trim() ?? null;
        if (personaName) {
          playerIdsByName.set(personaName.toLowerCase(), player.id);
        }
      }

      const reactions: CpuOutcomeReactions = [];
      for (const reaction of rawReactions) {
        const message = reaction.reaction.trim();
        if (!message) {
          continue;
        }
        let resolvedPlayerId = reaction.playerId;
        if (!knownPlayerIds.has(resolvedPlayerId)) {
          const normalized = reaction.playerId.trim().toLowerCase();
          const mappedId = playerIdsByName.get(normalized);
          if (mappedId) {
            resolvedPlayerId = mappedId;
          }
        }
        if (!knownPlayerIds.has(resolvedPlayerId)) {
          continue;
        }
        reactions.push({
          playerId: resolvedPlayerId,
          reaction: message,
        });
      }

      if (reactions.length > 0) {
        console.info("[cards-ai] CPU outcome reactions", {
          promptId: prompt.id,
          winningCardId: winningCard.id,
          reactions,
        });
      }
      return reactions;
    } catch (error) {
      console.warn(
        "[cards-ai] CPU outcome reaction request failed",
        error instanceof Error ? error.message : error,
      );
      return;
    }
  }

  private async requestPromptIfNeeded() {
    if (this.isRequestingPrompt || this.state.prompt) {
      return;
    }

    this.isRequestingPrompt = true;
    this.dispatchAction({ type: "GET_PROMPT" });
    try {
      const previousPromptTexts = this.state.discardedPromptCards.map(
        (prompt) => prompt.text,
      );
      const handTexts = this.getNonJudgeHandTexts();
      const prompt = await createPromptFromModel({
        previousPromptTexts,
        handTexts,
      });
      this.receivePrompt(prompt);
    } catch (error) {
      console.warn(
        "[cards-ai] prompt request failed",
        error instanceof Error ? error.message : error,
      );
    } finally {
      this.isRequestingPrompt = false;
    }
  }

  judgeAnswers(result: JudgementResult) {
    this.dispatchAction({ type: "RETURN_JUDGEMENT", result });
  }

  receivePrompt(prompt: PromptCard) {
    this.dispatchAction({ type: "PROMPT_RECEIVED", prompt });
  }
}

const keyLength = 8;
function generateKey() {
  return Math.random()
    .toString(36)
    .substring(2, keyLength + 2);
}

export function fisherYatesShuffle<T>(array: T[]): T[] {
  for (let index = array.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [array[index], array[swapIndex]] = [array[swapIndex], array[index]];
  }

  return array;
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface CpuAnswerChoice {
  playerId: string;
  cardId: string;
  playerComment: string;
}

type CpuAnswerCardChoices = CpuAnswerChoice[];

interface CpuOutcomeReaction {
  playerId: string;
  reaction: string;
}

type CpuOutcomeReactions = CpuOutcomeReaction[];

interface CpuJudgementChoice {
  winningCardId: string;
  reactionToWinningCard: string;
}

interface CpuJudgementCandidate {
  cardId: string;
  cardText: string;
  playerId: string;
  playerPersona: Persona | null;
}

interface CpuJudgementRequestPayload {
  goal: string;
  judge: { id: string; persona: Persona | null };
  prompt: { id: string; text: string };
  answers: CpuJudgementCandidate[];
}

interface CpuJudgementRequestArgs {
  prompt: PromptCard;
  judge: Player;
  playedAnswerCards: GameState["playedAnswerCards"];
  answerCards: Record<string, AnswerCard>;
  players: Player[];
}

function buildPromptText(previousPromptTexts: string[], handTexts: string[]): string {
  const lines: string[] = [
    "Generate one Cards Against AI prompt.",
    "Requirements:",
    "- Must include exactly one blank represented by four underscores: ____",
    "- Keep it one sentence.",
    "- Return only JSON matching: {\"text\": \"...\"}.",
  ];

  if (handTexts.length > 0) {
    lines.push(
      "Use the following answer card texts as inspiration.",
      "Craft a prompt that humorously fits at least a few of them.",
      "Answer card texts:",
    );
    for (const text of handTexts) {
      lines.push(`- ${text}`);
    }
  }

  if (previousPromptTexts.length > 0) {
    lines.push("Avoid repeating any of these prompts:");
    for (const prompt of previousPromptTexts) {
      lines.push(`- ${prompt}`);
    }
  }

  return lines.join("\n");
}

async function createPromptFromModel(args: {
  previousPromptTexts: string[];
  handTexts: string[];
}): Promise<PromptCard> {
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENAI_API_SECRET ?? null;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content:
            "You write funny Cards Against Humanity-style prompt cards. Keep it lighthearted and avoid offensive content.",
        },
        {
          role: "user",
          content: buildPromptText(args.previousPromptTexts, args.handTexts),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "prompt_card",
          schema: {
            type: "object",
            properties: {
              text: { type: "string" },
            },
            required: ["text"],
            additionalProperties: false,
          },
        },
      },
    }),
  });

  const json = await response.json();
  if (!response.ok) {
    const message =
      typeof json?.error?.message === "string"
        ? json.error.message
        : response.statusText;
    throw new Error(`OpenAI request failed: ${message}`);
  }

  const responseText = extractResponseText(json);
  if (!responseText) {
    throw new Error("OpenAI response did not include any text.");
  }

  let promptText = responseText;
  try {
    const parsed = JSON.parse(responseText) as { text?: string };
    if (typeof parsed.text === "string") {
      promptText = parsed.text;
    }
  } catch {
    // fall back to raw text
  }

  return {
    id: `prompt-${crypto.randomUUID()}`,
    type: "prompt",
    text: promptText.trim(),
  };
}

async function requestCpuAnswerChoices(args: {
  prompt: PromptCard;
  cpuPlayers: Player[];
  answerCards: Record<string, AnswerCard>;
}): Promise<CpuAnswerCardChoices> {
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENAI_API_SECRET ?? null;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: [
            "You are selecting answer cards for CPU players in a Cards Against AI round.",
            "Return structured JSON only, matching the provided schema.",
            "Choose exactly one card per CPU player from their hand.",
            "playerComment should fit the player's persona and must not reveal card text or other cards.",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify(
            buildCpuChoiceRequest(args.prompt, args.cpuPlayers, args.answerCards),
            null,
            2,
          ),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "cpu_answer_choices",
          schema: {
            type: "object",
            properties: {
              choices: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    playerId: { type: "string" },
                    cardId: { type: "string" },
                    playerComment: { type: "string" },
                  },
                  required: ["playerId", "cardId", "playerComment"],
                  additionalProperties: false,
                },
              },
            },
            required: ["choices"],
            additionalProperties: false,
          },
        },
      },
    }),
  });

  const json = await response.json();
  if (!response.ok) {
    const message =
      typeof json?.error?.message === "string"
        ? json.error.message
        : response.statusText;
    throw new Error(`OpenAI request failed: ${message}`);
  }

  const responseText = extractResponseText(json);
  if (!responseText) {
    throw new Error("OpenAI response did not include any text.");
  }

  const choices = parseCpuAnswerChoices(responseText);
  return choices ?? [];
}

async function requestCpuJudgement(
  args: CpuJudgementRequestArgs,
): Promise<CpuJudgementChoice | null> {
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENAI_API_SECRET ?? null;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: [
            "You are judging a Cards Against AI round as a CPU player.",
            "Return structured JSON only, matching the provided schema.",
            "Pick exactly one winning card from the provided answers.",
            "reactionToWinningCard should be 1-2 sentences in the judge's voice.",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify(buildCpuJudgementRequest(args), null, 2),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "cpu_judgement",
          schema: {
            type: "object",
            properties: {
              winningCardId: { type: "string" },
              reactionToWinningCard: { type: "string" },
            },
            required: ["winningCardId", "reactionToWinningCard"],
            additionalProperties: false,
          },
        },
      },
    }),
  });

  const json = await response.json();
  if (!response.ok) {
    const message =
      typeof json?.error?.message === "string"
        ? json.error.message
        : response.statusText;
    throw new Error(`OpenAI request failed: ${message}`);
  }

  const responseText = extractResponseText(json);
  if (!responseText) {
    throw new Error("OpenAI response did not include any text.");
  }

  return parseCpuJudgement(responseText);
}

function buildCpuChoiceRequest(
  prompt: PromptCard,
  cpuPlayers: Player[],
  answerCards: Record<string, AnswerCard>,
) {
  return {
    goal: "Pick the funniest answer card for each CPU player to submit.",
    prompt: {
      id: prompt.id,
      text: prompt.text,
    },
    cpuPlayers: cpuPlayers.map((player) => ({
      id: player.id,
      persona: player.persona,
      answerCards: player.answerCards
        .map((cardId) => answerCards[cardId])
        .filter((card): card is AnswerCard => Boolean(card))
        .map((card) => ({ id: card.id, text: card.text })),
    })),
  };
}

function buildCpuJudgementRequest(
  args: CpuJudgementRequestArgs,
): CpuJudgementRequestPayload {
  const playersById = new Map<string, Player>();
  for (const player of args.players) {
    playersById.set(player.id, player);
  }

  const answers: CpuJudgementCandidate[] = [];
  for (const played of args.playedAnswerCards) {
    const card = args.answerCards[played.cardId];
    if (!card) {
      continue;
    }
    const player = playersById.get(played.playerId) ?? null;
    answers.push({
      cardId: card.id,
      cardText: card.text,
      playerId: played.playerId,
      playerPersona: player?.persona ?? null,
    });
  }

  return {
    goal: "Pick the funniest answer as the judge.",
    judge: { id: args.judge.id, persona: args.judge.persona },
    prompt: { id: args.prompt.id, text: args.prompt.text },
    answers,
  };
}

function extractResponseText(response: unknown): string | null {
  if (!response || typeof response !== "object") {
    return null;
  }

  const candidate = response as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const firstChoice = candidate.choices?.[0];
  const content = firstChoice?.message?.content;
  return typeof content === "string" ? content : null;
}

function parseCpuAnswerChoices(responseText: string): CpuAnswerCardChoices | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    return null;
  }

  const rawChoices = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed
      ? (parsed as { choices?: unknown }).choices
      : null;

  if (!Array.isArray(rawChoices)) {
    return null;
  }

  const choices: CpuAnswerCardChoices = [];
  for (const entry of rawChoices) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const candidate = entry as Partial<CpuAnswerChoice>;
    if (
      typeof candidate.playerId !== "string" ||
      typeof candidate.cardId !== "string" ||
      typeof candidate.playerComment !== "string"
    ) {
      continue;
    }
    choices.push({
      playerId: candidate.playerId,
      cardId: candidate.cardId,
      playerComment: candidate.playerComment,
    });
  }

  return choices;
}

function parseCpuJudgement(responseText: string): CpuJudgementChoice | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    return null;
  }

  if (!parsed || typeof parsed !== "object") {
    return null;
  }

  const candidate = parsed as Partial<CpuJudgementChoice>;
  if (
    typeof candidate.winningCardId !== "string" ||
    typeof candidate.reactionToWinningCard !== "string"
  ) {
    return null;
  }

  return {
    winningCardId: candidate.winningCardId,
    reactionToWinningCard: candidate.reactionToWinningCard,
  };
}

function sanitizeCpuComment(comment: string | undefined, fallbackName?: string | null) {
  if (typeof comment === "string" && comment.trim().length > 0) {
    return comment.trim();
  }
  const name = fallbackName ?? "CPU";
  return `${name} is feeling this one.`;
}

function sanitizeCpuReaction(reaction: string | undefined, fallbackName?: string | null) {
  if (typeof reaction === "string" && reaction.trim().length > 0) {
    return reaction.trim();
  }
  const name = fallbackName ?? "CPU";
  return `${name} picks this one.`;
}

async function requestCpuOutcomeReactions(args: {
  prompt: PromptCard;
  winningCard: AnswerCard;
  judge: Player;
  winner: Player;
  cpuPlayers: Player[];
}): Promise<CpuOutcomeReactions> {
  const apiKey = process.env.OPENAI_API_KEY ?? process.env.OPENAI_API_SECRET ?? null;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is not set.");
  }

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      authorization: `Bearer ${apiKey}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4.1-mini",
      messages: [
        {
          role: "system",
          content: [
            "You are generating short, in-character reactions from CPU players.",
            "Return structured JSON only, matching the provided schema.",
            "Each reaction should be 1-2 sentences.",
          ].join("\n"),
        },
        {
          role: "user",
          content: JSON.stringify(
            buildCpuOutcomeReactionRequest(args),
            null,
            2,
          ),
        },
      ],
      response_format: {
        type: "json_schema",
        json_schema: {
          name: "cpu_outcome_reactions",
          schema: {
            type: "object",
            properties: {
              reactions: {
                type: "array",
                items: {
                  type: "object",
                  properties: {
                    playerId: { type: "string" },
                    reaction: { type: "string" },
                  },
                  required: ["playerId", "reaction"],
                  additionalProperties: false,
                },
              },
            },
            required: ["reactions"],
            additionalProperties: false,
          },
        },
      },
    }),
  });

  const json = await response.json();
  if (!response.ok) {
    const message =
      typeof json?.error?.message === "string"
        ? json.error.message
        : response.statusText;
    throw new Error(`OpenAI request failed: ${message}`);
  }

  const responseText = extractResponseText(json);
  if (!responseText) {
    throw new Error("OpenAI response did not include any text.");
  }

  const reactions = parseCpuOutcomeReactions(responseText);
  return reactions ?? [];
}

function buildCpuOutcomeReactionRequest(args: {
  prompt: PromptCard;
  winningCard: AnswerCard;
  judge: Player;
  winner: Player;
  cpuPlayers: Player[];
}) {
  return {
    goal: "React to the round outcome in character.",
    prompt: { id: args.prompt.id, text: args.prompt.text },
    winningCard: { id: args.winningCard.id, text: args.winningCard.text },
    judge: { id: args.judge.id, persona: args.judge.persona },
    winner: { id: args.winner.id, persona: args.winner.persona },
    cpuPlayers: args.cpuPlayers.map((player) => ({
      id: player.id,
      persona: player.persona,
    })),
  };
}

function parseCpuOutcomeReactions(
  responseText: string,
): CpuOutcomeReactions | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(responseText);
  } catch {
    return null;
  }

  const rawReactions = Array.isArray(parsed)
    ? parsed
    : typeof parsed === "object" && parsed
      ? (parsed as { reactions?: unknown }).reactions
      : null;

  if (!Array.isArray(rawReactions)) {
    return null;
  }

  const reactions: CpuOutcomeReactions = [];
  for (const entry of rawReactions) {
    if (!entry || typeof entry !== "object") {
      continue;
    }
    const candidate = entry as Partial<CpuOutcomeReaction>;
    if (
      typeof candidate.playerId !== "string" ||
      typeof candidate.reaction !== "string"
    ) {
      continue;
    }
    reactions.push({
      playerId: candidate.playerId,
      reaction: candidate.reaction,
    });
  }

  return reactions;
}

function pickRandomAnswerCardId(answerCards: string[]) {
  if (!answerCards.length) {
    return null;
  }
  const index = Math.floor(Math.random() * answerCards.length);
  return answerCards[index];
}

function pickRandomPlayedCardId(playedAnswerCards: GameState["playedAnswerCards"]) {
  if (!playedAnswerCards.length) {
    return null;
  }
  const index = Math.floor(Math.random() * playedAnswerCards.length);
  return playedAnswerCards[index].cardId;
}

function findPlayedAnswerCard(
  playedAnswerCards: GameState["playedAnswerCards"],
  cardId: string,
) {
  for (const entry of playedAnswerCards) {
    if (entry.cardId === cardId) {
      return entry;
    }
  }
  return null;
}
