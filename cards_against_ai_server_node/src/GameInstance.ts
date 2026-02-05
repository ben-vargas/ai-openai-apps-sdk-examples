import {
  AnswerCard,
  GameState,
  JudgementResult,
  NextActionHint,
  Persona,
  Player,
  PromptCard,
} from "./shared-types.js";

interface InitializeNewGameAction {
  type: "INITIALIZE_NEW_GAME";
  players: PlayerInput[];
  firstPrompt: string;
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
    judgeId: string;
    winningCardId: string;
    winningPlayerId: string;
    reactionToWinningCard?: string;
  };
}

interface PromptReceivedAction {
  type: "PROMPT_RECEIVED";
  prompt: PromptCard;
}

interface PrepareForNextRoundAction {
  type: "PREPARE_FOR_NEXT_ROUND";
}

interface PlayerPlayedAnswerCardAction {
  type: "PLAYER_PLAYED_ANSWER_CARD";
  playerId: string;
  cardId: string;
  playerComment?: string;
}

type GameAction =
  | InitializeNewGameAction
  | WaitingForPlayersAction
  | PlayerJoinedAction
  | DealCardsAction
  | WaitingForAnswersAction
  | JudgingAction
  | ReturnJudgementAction
  | PromptReceivedAction
  | PrepareForNextRoundAction
  | AnnounceWinnerAction
  | PlayerPlayedAnswerCardAction;

interface PlayerInput {
  id: string;
  name: string;
  type: "human" | "cpu";
  persona: Persona | null;
  answerCards: AnswerCard[];
}

interface GameInstanceOptions {
  players: PlayerInput[];
  firstPrompt: string;
}

const ANSWER_HAND_SIZE = 7;

export class GameInstance {
  /** A unique key for the game instance. This can be used later to join the game. */
  readonly key = generateKey();
  private readonly options: GameInstanceOptions;
  private _changeListeners: Array<() => void> = [];

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
    winnerId: null,
  };

  constructor(options: GameInstanceOptions) {
    this.options = options;
  }

  getState(): GameState {
    return this.state;
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
      players: this.options.players,
      firstPrompt: this.options.firstPrompt,
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

    // Auto-advance to judging if all cards are in
    if (this.state.playedAnswerCards.length === this.getExpectedAnswerCount()) {
      this.dispatchAction({ type: "JUDGING" });
    }
  }

  /**
   * Submit CPU answer card choices from ChatGPT.
   */
  submitCpuAnswers(choices: Array<{ playerId: string; cardId: string; playerComment?: string }>) {
    const judge = this.state.players[this.state.currentJudgePlayerIndex];
    const cpuPlayers = this.state.players.filter(
      (player) => player.type === "cpu" && player.id !== judge?.id,
    );

    const choicesByPlayerId = new Map<string, typeof choices[number]>();
    for (const choice of choices) {
      choicesByPlayerId.set(choice.playerId, choice);
    }

    for (const player of cpuPlayers) {
      if (this.state.playedAnswerCards.some((played) => played.playerId === player.id)) {
        continue;
      }

      const choice = choicesByPlayerId.get(player.id);
      let cardIdToPlay: string | null = choice?.cardId ?? null;

      if (!cardIdToPlay || !player.answerCards.includes(cardIdToPlay)) {
        cardIdToPlay = pickRandomAnswerCardId(player.answerCards);
      }

      if (!cardIdToPlay) {
        continue;
      }

      const comment = sanitizeCpuComment(choice?.playerComment, player.persona?.name);
      this.playAnswerCard(player.id, cardIdToPlay, comment);
    }
  }

  /**
   * Submit CPU judgement from ChatGPT.
   */
  submitCpuJudgement(result: { winningCardId: string; reactionToWinningCard?: string }) {
    const judge = this.state.players[this.state.currentJudgePlayerIndex];
    const playedAnswerCards = this.state.playedAnswerCards;

    let winningCardId = result.winningCardId;
    if (!findPlayedAnswerCard(playedAnswerCards, winningCardId)) {
      winningCardId = pickRandomPlayedCardId(playedAnswerCards) ?? winningCardId;
    }

    const winningEntry = findPlayedAnswerCard(playedAnswerCards, winningCardId);
    if (!winningEntry) {
      console.warn("CPU judgement winning card not found in played answers", {
        winningCardId,
      });
      return;
    }

    const reaction = sanitizeCpuReaction(
      result.reactionToWinningCard,
      judge?.persona?.name,
    );
    this.judgeAnswers({
      judgeId: judge.id,
      winningCardId,
      winningPlayerId: winningEntry.playerId,
      reactionToWinningCard: reaction,
    });
  }

  /**
   * Submit a prompt card from ChatGPT along with replacement cards.
   * Internally calls prepareForNextRound first, then sets the new prompt.
   */
  submitPrompt(promptText: string, replacementCards?: Array<{ playerId: string; card: AnswerCard }>) {
    // Prepare for next round (clear played cards, rotate judge, etc.)
    this.dispatchAction({ type: "PREPARE_FOR_NEXT_ROUND" });

    // Deal replacement cards before setting new prompt
    if (replacementCards && replacementCards.length > 0) {
      this.dealReplacementCards(replacementCards);
    }

    const prompt: PromptCard = {
      id: `prompt-${crypto.randomUUID()}`,
      type: "prompt",
      text: promptText.trim(),
    };
    this.dispatchAction({ type: "PROMPT_RECEIVED", prompt });
  }

  /**
   * Deal replacement cards to players.
   */
  private dealReplacementCards(replacementCards: Array<{ playerId: string; card: AnswerCard }>) {
    const newAnswerCards = { ...this.state.answerCards };
    const updatedPlayers = this.state.players.map((player) => {
      const replacement = replacementCards.find((r) => r.playerId === player.id);
      if (!replacement) {
        return player;
      }

      // Add card to registry
      newAnswerCards[replacement.card.id] = replacement.card;

      // Add card to player's hand
      return {
        ...player,
        answerCards: [...player.answerCards, replacement.card.id],
      };
    });

    this.state = {
      ...this.state,
      answerCards: newAnswerCards,
      players: updatedPlayers,
    };
  }

  /**
   * Get context for ChatGPT to make CPU decisions.
   */
  getCpuContext() {
    const judge = this.state.players[this.state.currentJudgePlayerIndex] ?? null;

    const cpuPlayers = this.state.players
      .filter(
        (player) =>
          player.type === "cpu" &&
          player.id !== judge?.id &&
          !this.state.playedAnswerCards.some(
            (played) => played.playerId === player.id,
          ),
      )
      .map((player) => ({
        id: player.id,
        name: player.persona?.name ?? "CPU",
        persona: player.persona,
        hand: player.answerCards
          .map((cardId) => {
            const card = this.state.answerCards[cardId];
            return card ? { id: card.id, text: card.text } : null;
          })
          .filter((card): card is { id: string; text: string } => card !== null),
      }));

    const playedAnswers = this.state.playedAnswerCards.map((played) => {
      const card = this.state.answerCards[played.cardId];
      return {
        cardId: played.cardId,
        text: card?.text ?? "",
      };
    });

    return {
      prompt: this.state.prompt ? { text: this.state.prompt.text } : null,
      cpuPlayers,
      playedAnswers: playedAnswers.length > 0 ? playedAnswers : undefined,
      previousPromptTexts: this.state.discardedPromptCards.map((p) => p.text),
      handTexts: this.getNonJudgeHandTexts(),
      judge: judge ? { id: judge.id, name: judge.persona?.name ?? "Unknown" } : null,
    };
  }

  /**
   * Compute the next action hint for ChatGPT.
   */
  computeNextAction(): NextActionHint {
    const { status, players, currentJudgePlayerIndex, playedAnswerCards } = this.state;
    const judge = players[currentJudgePlayerIndex] ?? null;

    if (status === "announce-winner" || status === "game-ended") {
      const winner = players.find((p) => p.id === this.state.winnerId);
      return {
        action: "game-over",
        description: `Game over! ${winner?.persona?.name ?? "Someone"} wins with ${winner?.wonPromptCards.length ?? 0} points.`,
      };
    }

    if (status === "waiting-for-answers") {
      // Human plays FIRST
      const humanPlayerPending = players.some(
        (p) =>
          p.type === "human" &&
          p.id !== judge?.id &&
          !playedAnswerCards.some((played) => played.playerId === p.id),
      );

      if (humanPlayerPending) {
        return {
          action: "human-answer-pending",
          description: "Waiting for the human player to play an answer card.",
        };
      }

      // Then CPU players
      const cpuPlayersWhoNeedToPlay = players.filter(
        (p) =>
          p.type === "cpu" &&
          p.id !== judge?.id &&
          !playedAnswerCards.some((played) => played.playerId === p.id),
      );

      if (cpuPlayersWhoNeedToPlay.length > 0) {
        return {
          action: "submit-cpu-answers",
          description: `CPU players need to play answer cards. ${cpuPlayersWhoNeedToPlay.length} CPU player(s) still need to play.`,
        };
      }

      return null;
    }

    if (status === "judging") {
      if (judge?.type === "cpu") {
        return {
          action: "submit-cpu-judgement",
          description: `${judge.persona?.name ?? "CPU judge"} needs to pick the winning card.`,
        };
      }

      return {
        action: "human-judge-pending",
        description: "Waiting for the human player to judge the cards.",
      };
    }

    if (status === "display-judgement") {
      // After judgement, check for winner
      const winner = players.find((p) => p.wonPromptCards.length >= 5);
      if (winner) {
        return {
          action: "game-over",
          description: `${winner.persona?.name ?? "Someone"} has won the game with ${winner.wonPromptCards.length} points!`,
        };
      }

      return {
        action: "submit-prompt",
        description: "Round complete. Submit a new prompt card and replacement answer cards for the next round.",
      };
    }

    if (status === "prepare-for-next-round" || status === "dealing") {
      return {
        action: "submit-prompt",
        description: "Submit a new prompt card and replacement answer cards for the next round.",
      };
    }

    return null;
  }

  judgeAnswers(result: JudgementResult) {
    const currentJudge = this.state.players[this.state.currentJudgePlayerIndex];
    if (!currentJudge || currentJudge.id !== result.judgeId) {
      throw new Error(`Player ${result.judgeId} is not the current judge`);
    }

    this.dispatchAction({ type: "RETURN_JUDGEMENT", result });

    // Check for winner (first to 5 wins)
    const winner = this.state.players.find((p) => p.wonPromptCards.length >= 5);
    if (winner) {
      this.dispatchAction({ type: "ANNOUNCE_WINNER", winnerId: winner.id });
    }
  }

  private reducer(prevState: GameState, action: GameAction): GameState {
    switch (action.type) {
      case "INITIALIZE_NEW_GAME": {
        // Build answerCards map from all player hands
        const answerCards: Record<string, AnswerCard> = {};
        for (const playerInput of action.players) {
          for (const card of playerInput.answerCards) {
            answerCards[card.id] = card;
          }
        }

        // Create players from input
        const players: Player[] = action.players.map((playerInput) => ({
          id: playerInput.id,
          type: playerInput.type,
          persona: playerInput.persona ? {
            id: playerInput.persona.id,
            name: playerInput.persona.name ?? playerInput.name,
            personality: playerInput.persona.personality,
            likes: playerInput.persona.likes,
            dislikes: playerInput.persona.dislikes,
            humorStyle: playerInput.persona.humorStyle,
            favoriteJokeTypes: playerInput.persona.favoriteJokeTypes,
          } : {
            id: playerInput.id,
            name: playerInput.name,
            personality: "",
            likes: [],
            dislikes: [],
            humorStyle: [],
            favoriteJokeTypes: [],
          },
          wonPromptCards: [],
          answerCards: playerInput.answerCards.map((card) => card.id),
        }));

        // Create first prompt
        const firstPrompt: PromptCard = {
          id: `prompt-${crypto.randomUUID()}`,
          type: "prompt",
          text: action.firstPrompt,
        };

        // Find first CPU player to be judge (human should never judge first)
        const firstCpuIndex = players.findIndex((p) => p.type === "cpu");
        const judgeIndex = firstCpuIndex >= 0 ? firstCpuIndex : 0;

        return {
          ...prevState,
          status: "waiting-for-answers",
          players,
          answerCards,
          answerDeck: [],
          prompt: firstPrompt,
          currentJudgePlayerIndex: judgeIndex,
        };
      }
      case "WAITING_FOR_PLAYERS": {
        return {
          ...prevState,
          status: "waiting-for-players",
        };
      }
      case "PLAYER_JOINED": {
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
          players,
        };
      }
      case "PREPARE_FOR_NEXT_ROUND": {
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
        return {
          ...prevState,
          status: "waiting-for-answers",
          prompt: action.prompt,
          playedAnswerCards: [],
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
      default: {
        return prevState;
      }
    }
  }

  /**
   * Returns a promise that resolves when the game state changes or the signal
   * is aborted (e.g. timeout or client disconnect).
   */
  waitForChange(signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const cleanup = () => {
        this._changeListeners = this._changeListeners.filter((l) => l !== onChange);
        resolve();
      };
      const onChange = () => {
        signal.removeEventListener("abort", cleanup);
        resolve();
      };
      signal.addEventListener("abort", cleanup, { once: true });
      this._changeListeners.push(onChange);
    });
  }

  private notifyChange() {
    const listeners = this._changeListeners;
    this._changeListeners = [];
    for (const listener of listeners) {
      listener();
    }
  }

  private dispatchAction(action: GameAction) {
    this.state = this.reducer(this.state, action);
    this.notifyChange();
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
}

const keyLength = 8;
function generateKey() {
  return Math.random()
    .toString(36)
    .substring(2, keyLength + 2);
}

export function fisherYatesShuffle<T>(array: T[]): T[] {
  const result = [...array];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[randomIndex]] = [result[randomIndex], result[index]];
  }
  return result;
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
