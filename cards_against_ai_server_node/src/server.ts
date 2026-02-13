/**
 * Cards Against AI MCP server (Node).
 *
 * Exposes game tools over MCP. All game state flows through tool responses.
 * Uses McpServer + StreamableHTTP + ext-apps (MCP Apps standard).
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  registerAppTool,
  registerAppResource,
  RESOURCE_MIME_TYPE,
} from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";

import { GameInstance } from "./GameInstance.js";
import type { IntroDialogEntry } from "./shared-types.js";

// Use express from the SDK's own dependencies
import express from "express";
import cors from "cors";

interface GameRecord {
  id: string;
  key: string;
  instance: GameInstance;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..", "..");
const ASSETS_DIR = path.resolve(ROOT_DIR, "assets");
const TEMPLATE_URI = "ui://widget/cards-against-ai.html";
const RULES_URI = "rules://cards-against-ai";
const ANSWER_GUIDANCE_URI = "rules://cards-against-ai/answer-deck";
const MARKDOWN_MIME_TYPE = "text/markdown";
const RULES_PATH = path.resolve(
  ROOT_DIR,
  "cards_against_ai_server_node",
  "RULES.md",
);
const ANSWER_GUIDANCE_PATH = path.resolve(
  ROOT_DIR,
  "cards_against_ai_server_node",
  "ANSWER_DECK_GUIDANCE.md",
);

dotenv.config({ path: path.resolve(ROOT_DIR, ".env.local") });

const ASSETS_BASE_URL = normalizeBaseUrl(
  process.env.ASSETS_BASE_URL ??
    process.env.BASE_URL ??
    process.env.VITE_BASE_URL ??
    "",
);
const ASSETS_BASE_ORIGIN = parseOrigin(ASSETS_BASE_URL);
const API_BASE_URL = normalizeBaseUrl(
  process.env.API_BASE_URL ??
    process.env.VITE_API_BASE_URL ??
    "http://localhost:8000",
);
const API_BASE_ORIGIN = parseOrigin(API_BASE_URL);

const widgetConnectDomains: string[] = [];
if (ASSETS_BASE_ORIGIN) {
  widgetConnectDomains.push(ASSETS_BASE_ORIGIN);
}
if (API_BASE_ORIGIN) {
  widgetConnectDomains.push(API_BASE_ORIGIN);
}

const OPENAI_ASSETS_ORIGIN = "https://persistent.oaistatic.com";
const widgetResourceDomains = ASSETS_BASE_ORIGIN
  ? [ASSETS_BASE_ORIGIN, OPENAI_ASSETS_ORIGIN]
  : [OPENAI_ASSETS_ORIGIN];
const widgetCspDomains = buildWidgetCspDomains(
  widgetConnectDomains,
  widgetResourceDomains,
  ASSETS_BASE_ORIGIN,
);

const gamesById = new Map<string, GameRecord>();

function normalizeBaseUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.replace(/\/+$/, "");
}

function parseOrigin(value: string | null): string | null {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function buildWidgetCspDomains(
  connectDomains: string[],
  resourceDomains: string[],
  extraDomain: string | null,
): { connectDomains: string[]; resourceDomains: string[] } {
  const connect = new Set(connectDomains);
  const resource = new Set(resourceDomains);

  if (extraDomain) {
    connect.add(extraDomain);
    resource.add(extraDomain);
  }

  return {
    connectDomains: [...connect],
    resourceDomains: [...resource],
  };
}

function readWidgetHtml(): string {
  if (!fs.existsSync(ASSETS_DIR)) {
    throw new Error(
      `Widget assets not found. Expected directory ${ASSETS_DIR}. Run "pnpm run build" before starting the server.`,
    );
  }

  const directPath = path.join(ASSETS_DIR, "cards-against-ai.html");
  let htmlContents: string | null = null;

  if (fs.existsSync(directPath)) {
    htmlContents = fs.readFileSync(directPath, "utf8");
  } else {
    const candidates = fs
      .readdirSync(ASSETS_DIR)
      .filter(
        (file) =>
          file.startsWith("cards-against-ai-") && file.endsWith(".html"),
      )
      .sort();
    const fallback = candidates[candidates.length - 1];
    if (fallback) {
      htmlContents = fs.readFileSync(path.join(ASSETS_DIR, fallback), "utf8");
    }
  }

  if (!htmlContents) {
    throw new Error(
      `Widget HTML for "cards-against-ai" not found in ${ASSETS_DIR}. Run "pnpm run build" to generate the assets.`,
    );
  }

  if (ASSETS_BASE_URL) {
    return htmlContents.replaceAll(
      "http://localhost:4444",
      ASSETS_BASE_URL,
    );
  }

  return htmlContents;
}

function readMarkdownFile(filePath: string, label: string): string {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Cards Against AI ${label} not found. Expected file ${filePath}.`,
    );
  }

  return fs.readFileSync(filePath, "utf8");
}

const widgetHtml = readWidgetHtml();
const rulesMarkdown = readMarkdownFile(RULES_PATH, "rules");
const answerGuidanceMarkdown = readMarkdownFile(
  ANSWER_GUIDANCE_PATH,
  "answer deck guidance",
);

// --- UI metadata for tools and resources ---

const toolUiMeta = {
  ui: {
    resourceUri: TEMPLATE_URI,
  },
};

// --- Zod schemas for tool input ---

const cpuPersonaParser = z.object({
  id: z.string(),
  name: z.string(),
  personality: z.string(),
  likes: z.array(z.string()),
  dislikes: z.array(z.string()),
  humorStyle: z.array(z.string()),
  favoriteJokeTypes: z.array(z.string()),
});

const answerCardParser = z.object({
  id: z.string(),
  type: z.literal("answer"),
  text: z.string(),
});

const introDialogEntryParser = z.object({
  playerId: z.string(),
  playerName: z.string(),
  dialog: z.string(),
});

const playerInputParser = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["human", "cpu"]),
  persona: cpuPersonaParser.optional(),
  answerCards: z.array(answerCardParser),
});

const startGameShape = {
  players: z.array(playerInputParser).min(4).max(4),
  firstPrompt: z.string(),
  introDialog: z.array(introDialogEntryParser),
};

const playAnswerCardShape = {
  gameId: z.string(),
  playerId: z.string(),
  cardId: z.string(),
};

const judgeAnswerCardShape = {
  gameId: z.string(),
  playerId: z.string(),
  winningCardId: z.string(),
};

const advanceCpuTurnShape = {
  gameId: z.string(),
  cpuAnswerChoices: z.array(
    z.object({
      playerId: z.string(),
      cardId: z.string(),
      playerComment: z.string().optional(),
    }),
  ),
  cpuJudgement: z.object({
    winningCardId: z.string(),
    reactionToWinningCard: z.string().optional(),
  }).optional(),
};

const replacementCardParser = z.object({
  playerId: z.string(),
  card: answerCardParser,
});

const submitPromptShape = {
  gameId: z.string(),
  promptText: z.string(),
  replacementCards: z.array(replacementCardParser),
};

// --- Game logic helpers ---

function buildGameToolResponse(
  toolName: string,
  record: GameRecord,
  textContent: string,
) {
  return {
    _meta: {
      ...toolUiMeta,
      "openai/widgetSessionId": record.id,
    },
    content: [
      ...(textContent ? [{ type: "text" as const, text: textContent }] : []),
      {
        type: "text" as const,
        text: JSON.stringify({
          gameId: record.id,
          gameKey: record.key,
          gameState: record.instance.getState(),
          nextAction: record.instance.computeNextAction(),
        }),
        annotations: { audience: ["assistant" as const] },
      },
    ],
    structuredContent: {
      invocation: toolName,
      gameId: record.id,
      gameKey: record.key,
      gameState: record.instance.getState(),
      nextAction: record.instance.computeNextAction(),
    },
  };
}

function gameNotFoundError(toolName: string) {
  return {
    _meta: toolUiMeta,
    isError: true as const,
    content: [{ type: "text" as const, text: "Unknown game id" }],
    structuredContent: {
      invocation: toolName,
    },
  };
}

function getGameRecord(gameId: string) {
  return gamesById.get(gameId) ?? null;
}

function formatIntroDialog(introDialog: IntroDialogEntry[]): string {
  if (introDialog.length === 0) {
    return "";
  }

  return introDialog
    .map((entry) => `**${entry.playerName}**: "${entry.dialog}"`)
    .join("\n\n");
}

function formatCpuAnswerQuips(
  choices: Array<{ playerId: string; cardId: string; playerComment?: string }>,
  instance: GameInstance,
): string {
  const state = instance.getState();
  const lines: string[] = [];

  for (const choice of choices) {
    const player = state.players.find((p) => p.id === choice.playerId);
    const name = player?.persona?.name ?? "CPU";
    const comment = choice.playerComment?.trim();

    if (comment) {
      lines.push(`**${name}** slaps down a card:\n"${comment}"`);
    } else {
      lines.push(`**${name}** plays a card silently.`);
    }
  }

  return lines.join("\n\n");
}

// --- Logging helper ---

function logToolCall(toolName: string, args: unknown, result: unknown) {
  const timestamp = new Date().toISOString();
  console.log(`\n[${timestamp}] ===== TOOL CALL: ${toolName} =====`);
  console.log(`[${timestamp}] INPUT:`, JSON.stringify(args, null, 2));
  console.log(`[${timestamp}] OUTPUT:`, JSON.stringify(result, null, 2));
  console.log(`[${timestamp}] ===== END: ${toolName} =====\n`);
}

// --- Server creation ---

const toolAnnotations = {
  // Game tools only mutate internal server state, not user data —
  // marking as read-only tells ChatGPT to skip confirmation dialogs.
  readOnlyHint: true as const,
  // These tools never delete or overwrite user data.
  destructiveHint: false as const,
  // These tools don't interact with external services or publish content.
  openWorldHint: false as const,
};

function createCardsAgainstAiServer(): McpServer {
  const server = new McpServer(
    {
      name: "cards-against-ai-node",
      version: "0.1.0",
    },
    {
      capabilities: {
        resources: {},
        tools: {},
      },
    },
  );

  // --- Register resources ---

  registerAppResource(
    server,
    "Cards Against AI widget",
    TEMPLATE_URI,
    {
      description: "Cards Against AI widget markup",
      mimeType: RESOURCE_MIME_TYPE,
    },
    async () => ({
      contents: [
        {
          uri: TEMPLATE_URI,
          mimeType: RESOURCE_MIME_TYPE,
          text: widgetHtml,
          _meta: {
            ui: {
              csp: {
                connectDomains: widgetCspDomains.connectDomains,
                resourceDomains: widgetCspDomains.resourceDomains,
              },
            },
          },
        },
      ],
    }),
  );

  registerAppResource(
    server,
    "Cards Against AI rules",
    RULES_URI,
    {
      description: "Cards Against AI game rules",
      mimeType: MARKDOWN_MIME_TYPE,
    },
    async () => ({
      contents: [
        {
          uri: RULES_URI,
          mimeType: MARKDOWN_MIME_TYPE,
          text: rulesMarkdown,
        },
      ],
    }),
  );

  registerAppResource(
    server,
    "Cards Against AI answer deck guidance",
    ANSWER_GUIDANCE_URI,
    {
      description: "Guidance for crafting the answer deck",
      mimeType: MARKDOWN_MIME_TYPE,
    },
    async () => ({
      contents: [
        {
          uri: ANSWER_GUIDANCE_URI,
          mimeType: MARKDOWN_MIME_TYPE,
          text: answerGuidanceMarkdown,
        },
      ],
    }),
  );

  // --- Register tools ---

  registerAppTool(
    server,
    "start-game",
    {
      title: "Start a Cards Against AI game",
      description:
        "Creates a new game instance and returns its gameId/gameKey along with the initial gameState. Provide exactly 4 players (1 human + 3 CPU recommended). Each player needs: id, name, type ('human' or 'cpu'), answerCards (7 cards each), and persona (required for CPU, optional for human). The firstPrompt is the first round's prompt card text (must contain ____). The introDialog array contains role-played introductions from each CPU character. The response includes gameState and nextAction — use nextAction to determine what tool to call next. First to 5 wins! Full rules are in rules://cards-against-ai. Answer card guidance in rules://cards-against-ai/answer-deck.",
      inputSchema: startGameShape,
      _meta: toolUiMeta,
      annotations: toolAnnotations,
    },
    async (args) => {
      if (!args.firstPrompt.includes("____")) {
        const result = {
          _meta: toolUiMeta,
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: "firstPrompt must contain ____ (four underscores) for the blank.",
            },
          ],
        };
        logToolCall("start-game", args, result);
        return result;
      }

      const gameId = randomUUID();
      const instance = new GameInstance({
        players: args.players.map((p) => ({
          id: p.id,
          name: p.name,
          type: p.type,
          persona: p.persona ?? null,
          answerCards: p.answerCards,
        })),
        firstPrompt: args.firstPrompt,
      });
      instance.initializeNewGame();

      const gameKey = instance.key;
      const record = { id: gameId, key: gameKey, instance };
      gamesById.set(gameId, record);

      const introTextContent = formatIntroDialog(args.introDialog);
      const result = buildGameToolResponse("start-game", record, introTextContent);
      logToolCall("start-game", args, result);
      return result;
    },
  );

  registerAppTool(
    server,
    "play-answer-card",
    {
      title: "Play an answer card",
      description:
        "Plays an answer card from the human player's hand. The human will provide gameId, playerId, and cardId via chat. Returns updated gameState and nextAction. If nextAction is 'advance-cpu-turn', immediately call advance-cpu-turn.",
      inputSchema: playAnswerCardShape,
      _meta: toolUiMeta,
      annotations: toolAnnotations,
    },
    async (args) => {
      const record = getGameRecord(args.gameId);
      if (!record) {
        const result = gameNotFoundError("play-answer-card");
        logToolCall("play-answer-card", args, result);
        return result;
      }

      try {
        record.instance.playAnswerCard(args.playerId, args.cardId);
      } catch (error) {
        const result = {
          _meta: toolUiMeta,
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: error instanceof Error ? error.message : "Failed to play answer card.",
            },
          ],
        };
        logToolCall("play-answer-card", args, result);
        return result;
      }

      const nextAction = record.instance.computeNextAction();
      const cpuContext = nextAction?.action === "advance-cpu-turn"
        ? record.instance.getCpuContext()
        : undefined;

      const result = {
        _meta: {
          ...toolUiMeta,
          "openai/widgetSessionId": record.id,
        },
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({
              gameId: record.id,
              gameKey: record.key,
              gameState: record.instance.getState(),
              nextAction,
              ...(cpuContext ? { cpuContext } : {}),
            }),
            annotations: { audience: ["assistant" as const] },
          },
        ],
        structuredContent: {
          invocation: "play-answer-card",
          gameId: record.id,
          gameKey: record.key,
          gameState: record.instance.getState(),
          nextAction,
          ...(cpuContext ? { cpuContext } : {}),
        },
      };
      logToolCall("play-answer-card", args, result);
      return result;
    },
  );

  registerAppTool(
    server,
    "judge-answer-card",
    {
      title: "Judge the winning answer card",
      description:
        "Records the human judge's winning card choice. The human will provide gameId, playerId, and winningCardId via chat. Returns updated gameState and nextAction.",
      inputSchema: judgeAnswerCardShape,
      _meta: toolUiMeta,
      annotations: toolAnnotations,
    },
    async (args) => {
      const record = getGameRecord(args.gameId);
      if (!record) {
        const result = gameNotFoundError("judge-answer-card");
        logToolCall("judge-answer-card", args, result);
        return result;
      }

      const state = record.instance.getState();
      const playedCard = state.playedAnswerCards.find(
        (played) => played.cardId === args.winningCardId,
      );
      if (!playedCard) {
        const result = {
          _meta: toolUiMeta,
          isError: true as const,
          content: [{ type: "text" as const, text: "Winning card not found in played cards." }],
        };
        logToolCall("judge-answer-card", args, result);
        return result;
      }

      try {
        record.instance.judgeAnswers({
          judgeId: args.playerId,
          winningCardId: args.winningCardId,
          winningPlayerId: playedCard.playerId,
        });
      } catch (error) {
        const result = {
          _meta: toolUiMeta,
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: error instanceof Error ? error.message : "Failed to judge answer card.",
            },
          ],
        };
        logToolCall("judge-answer-card", args, result);
        return result;
      }

      const result = buildGameToolResponse("judge-answer-card", record, "");
      logToolCall("judge-answer-card", args, result);
      return result;
    },
  );

  registerAppTool(
    server,
    "advance-cpu-turn",
    {
      title: "Advance CPU turn (answers + optional judgement)",
      description:
        "When nextAction.action === 'advance-cpu-turn', use this tool to submit CPU player card selections and optionally the CPU judge's verdict in a single call. Provide cpuAnswerChoices with playerId, cardId, and optional playerComment for each CPU player. If the judge is also a CPU, include cpuJudgement with winningCardId and optional reactionToWinningCard. Read CPU persona details and card hands from structuredContent.cpuContext in the play-answer-card response. After receiving the response, include cross-player banter in your chat message — reactions to the prompt, trash-talk, or commentary. Use the player personas from gameState to stay in character. Returns updated gameState and nextAction.",
      inputSchema: advanceCpuTurnShape,
      _meta: toolUiMeta,
      annotations: toolAnnotations,
    },
    async (args) => {
      const record = getGameRecord(args.gameId);
      if (!record) {
        const result = gameNotFoundError("advance-cpu-turn");
        logToolCall("advance-cpu-turn", args, result);
        return result;
      }

      const stateBefore = record.instance.getState();
      const judge = stateBefore.players[stateBefore.currentJudgePlayerIndex];
      const judgeName = judge?.persona?.name ?? "The Judge";

      try {
        record.instance.advanceCpuTurn(args.cpuAnswerChoices, args.cpuJudgement);
      } catch (error) {
        const result = {
          _meta: toolUiMeta,
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: error instanceof Error ? error.message : "Failed to advance CPU turn.",
            },
          ],
        };
        logToolCall("advance-cpu-turn", args, result);
        return result;
      }

      const parts: string[] = [];

      // CPU answer quips
      const answerQuips = formatCpuAnswerQuips(args.cpuAnswerChoices, record.instance);
      if (answerQuips) {
        parts.push(answerQuips);
      }

      // CPU judgement announcement
      if (args.cpuJudgement) {
        const stateAfter = record.instance.getState();
        const winningCard = stateAfter.answerCards[args.cpuJudgement.winningCardId];
        const winningPlayer = stateAfter.players.find(
          (p) => p.id === stateAfter.judgementResult?.winningPlayerId,
        );
        const winnerName = winningPlayer?.persona?.name ?? "Someone";
        const cardText = winningCard?.text ?? "???";
        const reaction = args.cpuJudgement.reactionToWinningCard?.trim() ?? "This one wins!";
        parts.push(`**${judgeName}** picks up a card and announces:\n\n"${cardText}"\n\n*${reaction}*\n\n**${winnerName}** wins this round!`);
      }

      const result = buildGameToolResponse("advance-cpu-turn", record, parts.join("\n\n---\n\n"));
      logToolCall("advance-cpu-turn", args, result);
      return result;
    },
  );

  registerAppTool(
    server,
    "submit-prompt",
    {
      title: "Submit a prompt card for the round",
      description:
        "When nextAction.action === 'submit-prompt', provide a new prompt card and replacement answer cards. The promptText must include exactly one blank (____). The replacementCards array should include one new answer card for each player who played last round (not the judge). After receiving the response, include between-round banter in your chat message — reactions to the last round, smack-talk, or hype for the next round. Use the player personas from gameState to stay in character. Returns updated gameState and nextAction.",
      inputSchema: submitPromptShape,
      _meta: toolUiMeta,
      annotations: toolAnnotations,
    },
    async (args) => {
      const record = getGameRecord(args.gameId);
      if (!record) {
        const result = gameNotFoundError("submit-prompt");
        logToolCall("submit-prompt", args, result);
        return result;
      }

      if (!args.promptText.includes("____")) {
        const result = {
          _meta: toolUiMeta,
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: "promptText must contain ____ (four underscores) for the blank.",
            },
          ],
        };
        logToolCall("submit-prompt", args, result);
        return result;
      }

      try {
        record.instance.submitPrompt(args.promptText, args.replacementCards);
      } catch (error) {
        const result = {
          _meta: toolUiMeta,
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: error instanceof Error ? error.message : "Failed to submit prompt.",
            },
          ],
        };
        logToolCall("submit-prompt", args, result);
        return result;
      }

      const result = buildGameToolResponse("submit-prompt", record, "");
      logToolCall("submit-prompt", args, result);
      return result;
    },
  );

  return server;
}

// --- HTTP server using Express + StreamableHTTP ---

const portEnv = Number(process.env.PORT ?? 8000);
const port = Number.isFinite(portEnv) ? portEnv : 8000;

const app = express();
app.use(cors());
app.use(express.json());

app.post("/mcp", async (req, res) => {
  const body = req.body;
  const method = Array.isArray(body) ? body.map((m: { method?: string }) => m.method).join(", ") : body?.method;
  console.log(`[mcp] POST /mcp — method: ${method}`);

  const server = createCardsAgainstAiServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    transport.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
});

app.get("/mcp", async (req, res) => {
  const server = createCardsAgainstAiServer();
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  res.on("close", () => {
    transport.close();
  });
  await server.connect(transport);
  await transport.handleRequest(req, res);
});

app.delete("/mcp", async (_req, res) => {
  res.status(405).end();
});

// --- SSE: push game state to widget on every change ---

app.get("/mcp/game/:gameId/state-stream", (req, res) => {
  const record = getGameRecord(req.params.gameId);
  if (!record) {
    res.status(404).json({ error: "Game not found" });
    return;
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "Access-Control-Allow-Origin": "*",
  });

  const sendState = () => {
    const data = JSON.stringify({
      gameState: record.instance.getState(),
      nextAction: record.instance.computeNextAction(),
    });
    res.write(`data: ${data}\n\n`);
  };

  // Send current state immediately
  sendState();

  // Push on every change
  record.instance.on("change", sendState);

  req.on("close", () => {
    record.instance.removeListener("change", sendState);
  });
});

app.listen(port, () => {
  console.log(
    `Cards Against AI MCP server listening on http://localhost:${port}`,
  );
  console.log(`  Streamable HTTP endpoint: POST http://localhost:${port}/mcp`);
});
