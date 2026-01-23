/**
 * Cards Against AI MCP server (Node).
 *
 * Exposes a start-game tool and streams game state updates over HTTP/2.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { on } from "node:events";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PassThrough } from "node:stream";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";
import fastify from "fastify";
import { FastifySSEPlugin } from "fastify-sse-v2";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListResourceTemplatesRequestSchema,
  ListResourcesRequestSchema,
  ListToolsRequestSchema,
  ReadResourceRequestSchema,
  type CallToolRequest,
  type ListResourceTemplatesRequest,
  type ListResourcesRequest,
  type ListToolsRequest,
  type ReadResourceRequest,
  type Resource,
  type ResourceTemplate,
  type Tool,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { GameInstance } from "./GameInstance.js";
import type { GameState } from "./shared-types.js";

interface GameRecord {
  id: string;
  key: string;
  instance: GameInstance;
}

interface BodyCapture {
  body: string;
  truncated: boolean;
  byteLength: number;
  error?: string;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, "..", "..");
const ASSETS_DIR = path.resolve(ROOT_DIR, "assets");
const TEMPLATE_URI = "ui://widget/cards-against-ai.html";
const RULES_URI = "rules://cards-against-ai";
const ANSWER_GUIDANCE_URI = "rules://cards-against-ai/answer-deck";
const MIME_TYPE = "text/html+skybridge";
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
const MCP_LOG_ENABLED =
  process.env.MCP_LOG === "1" || process.env.MCP_LOG === "true";
const MCP_LOG_BODY_BYTES = Number.parseInt(
  process.env.MCP_LOG_BODY_BYTES ?? "4096",
  10,
);
const MCP_LOG_BODY_LIMIT =
  Number.isFinite(MCP_LOG_BODY_BYTES) && MCP_LOG_BODY_BYTES > 0
    ? MCP_LOG_BODY_BYTES
    : 4096;
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
const gamesByKey = new Map<string, GameRecord>();
const requestTimings = new WeakMap<object, number>();

function parseRequestUrl(req: IncomingMessage): {
  path: string;
  query: Record<string, string>;
} {
  const base = `http://${req.headers.host ?? "localhost"}`;
  const url = new URL(req.url ?? "", base);
  const query: Record<string, string> = {};

  for (const [key, value] of url.searchParams.entries()) {
    if (query[key]) {
      query[key] = `${query[key]},${value}`;
    } else {
      query[key] = value;
    }
  }

  return { path: url.pathname, query };
}

function filterHeaders(
  headers: IncomingMessage["headers"],
): Record<string, string> {
  const filtered: Record<string, string> = {};
  const redacted = new Set(["authorization", "cookie"]);

  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (redacted.has(lowerKey)) {
      filtered[lowerKey] = "[redacted]";
      continue;
    }

    if (typeof value === "string") {
      filtered[lowerKey] = value;
      continue;
    }

    if (Array.isArray(value)) {
      filtered[lowerKey] = value.join(", ");
    }
  }

  return filtered;
}

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

function formatRequestBody(body: unknown): string {
  const bodyText = normalizeBodyText(body);
  if (bodyText === null || bodyText.trim() === "") {
    return "(empty)";
  }

  try {
    const parsed = JSON.parse(bodyText);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return bodyText;
  }
}

function logMcpEvent(event: string, data: Record<string, unknown>) {
  if (!MCP_LOG_ENABLED) {
    return;
  }

  const payload = {
    ts: new Date().toISOString(),
    event,
    ...data,
  };

  console.log(JSON.stringify(payload));
}

function normalizeBodyText(body: unknown): string | null {
  if (body === undefined || body === null) {
    return null;
  }

  if (typeof body === "string") {
    return body;
  }

  if (Buffer.isBuffer(body)) {
    return body.toString("utf8");
  }

  try {
    return JSON.stringify(body);
  } catch (error) {
    return String(error instanceof Error ? error.message : body);
  }
}

function buildBodyCapture(bodyText: string, maxBytes: number): BodyCapture {
  const byteLength = Buffer.byteLength(bodyText, "utf8");
  const truncated = byteLength > maxBytes;
  const body = truncated
    ? Buffer.from(bodyText, "utf8").subarray(0, maxBytes).toString("utf8")
    : bodyText;

  return {
    body,
    truncated,
    byteLength,
  };
}

function createProxyRequest(
  req: IncomingMessage,
  bodyText: string | null,
): IncomingMessage {
  if (bodyText === null) {
    return req;
  }

  const proxy = new PassThrough();
  const headers = { ...req.headers };

  headers["content-length"] = Buffer.byteLength(bodyText, "utf8").toString();
  headers["content-type"] =
    headers["content-type"] ?? "application/json";

  Object.assign(proxy, {
    headers,
    method: req.method,
    url: req.url,
    socket: req.socket,
  });

  proxy.end(bodyText);
  return proxy as unknown as IncomingMessage;
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

function toolDescriptorMeta() {
  return {
    "openai/outputTemplate": TEMPLATE_URI,
    "openai/widgetAccessible": true,
    "openai/widgetCSP": {
      "connect_domains": widgetCspDomains.connectDomains,
      "resource_domains": widgetCspDomains.resourceDomains,
    }
  } as const;
}

function toolInvocationMeta(invocation: string) {
  return {
    ...toolDescriptorMeta(),
    invocation,
  };
}

const widgetHtml = readWidgetHtml();
const rulesMarkdown = readMarkdownFile(RULES_PATH, "rules");
const answerGuidanceMarkdown = readMarkdownFile(
  ANSWER_GUIDANCE_PATH,
  "answer deck guidance",
);

function readMarkdownFile(filePath: string, label: string): string {
  if (!fs.existsSync(filePath)) {
    throw new Error(
      `Cards Against AI ${label} not found. Expected file ${filePath}.`,
    );
  }

  return fs.readFileSync(filePath, "utf8");
}

const cpuPersonaSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    personality: { type: "string" },
    likes: { type: "array", items: { type: "string" } },
    dislikes: { type: "array", items: { type: "string" } },
    humorStyle: { type: "array", items: { type: "string" } },
    favoriteJokeTypes: { type: "array", items: { type: "string" } },
  },
  required: [
    "id",
    "name",
    "personality",
    "likes",
    "dislikes",
    "humorStyle",
    "favoriteJokeTypes",
  ],
  additionalProperties: false,
} as const;

const humanPersonaSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    personality: { type: "string" },
    likes: { type: "array", items: { type: "string" } },
    dislikes: { type: "array", items: { type: "string" } },
    humorStyle: { type: "array", items: { type: "string" } },
    favoriteJokeTypes: { type: "array", items: { type: "string" } },
  },
  required: ["id", "name"],
  additionalProperties: false,
} as const;

const optionalHumanPersonaSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    name: { type: "string" },
    personality: { type: "string" },
    likes: { type: "array", items: { type: "string" } },
    dislikes: { type: "array", items: { type: "string" } },
    humorStyle: { type: "array", items: { type: "string" } },
    favoriteJokeTypes: { type: "array", items: { type: "string" } },
  },
  required: [],
  additionalProperties: false,
} as const;

const answerCardSchema = {
  type: "object",
  properties: {
    id: { type: "string" },
    type: { type: "string", const: "answer" },
    text: { type: "string" },
  },
  required: ["id", "type", "text"],
  additionalProperties: false,
} as const;

const startGameInputSchema = {
  type: "object",
  properties: {
    owner: {
      type: "object",
      properties: {
        id: { type: "string" },
        persona: humanPersonaSchema,
      },
      required: ["id", "persona"],
      additionalProperties: false,
    },
    otherPlayers: {
      type: "array",
      items: {
        oneOf: [
          {
            type: "object",
            properties: {
              type: { type: "string", const: "cpu" },
              persona: cpuPersonaSchema,
            },
            required: ["type", "persona"],
            additionalProperties: false,
          },
          {
            type: "object",
            properties: {
              type: { type: "string", const: "human" },
              persona: optionalHumanPersonaSchema,
            },
            required: ["type"],
            additionalProperties: false,
          },
        ],
      },
    },
    answerDeck: {
      type: "array",
      items: answerCardSchema,
    },
  },
  required: ["owner", "otherPlayers", "answerDeck"],
  additionalProperties: false,
} as const;

const joinGameInputSchema = {
  type: "object",
  properties: {
    gameKey: { type: "string" },
    player: {
      type: "object",
      properties: {
        id: { type: "string" },
        persona: humanPersonaSchema,
      },
      required: ["id", "persona"],
      additionalProperties: false,
    },
  },
  required: ["gameKey", "player"],
  additionalProperties: false,
} as const;

interface HumanPersonaInput {
  id: string;
  name: string;
  personality?: string;
  likes?: string[];
  dislikes?: string[];
  humorStyle?: string[];
  favoriteJokeTypes?: string[];
}

const cpuPersonaParser = z.object({
  id: z.string(),
  name: z.string(),
  personality: z.string(),
  likes: z.array(z.string()),
  dislikes: z.array(z.string()),
  humorStyle: z.array(z.string()),
  favoriteJokeTypes: z.array(z.string()),
});

const humanPersonaParser = z.object({
  id: z.string(),
  name: z.string(),
  personality: z.string().optional(),
  likes: z.array(z.string()).optional(),
  dislikes: z.array(z.string()).optional(),
  humorStyle: z.array(z.string()).optional(),
  favoriteJokeTypes: z.array(z.string()).optional(),
});

const optionalHumanPersonaParser = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  personality: z.string().optional(),
  likes: z.array(z.string()).optional(),
  dislikes: z.array(z.string()).optional(),
  humorStyle: z.array(z.string()).optional(),
  favoriteJokeTypes: z.array(z.string()).optional(),
});

const answerCardParser = z.object({
  id: z.string(),
  type: z.literal("answer"),
  text: z.string(),
});

const otherPlayerParser = z.union([
  z.object({ type: z.literal("human"), persona: optionalHumanPersonaParser.optional() }),
  z.object({ type: z.literal("cpu"), persona: cpuPersonaParser }),
]);

const startGameParser = z.object({
  owner: z.object({ id: z.string(), persona: humanPersonaParser }),
  otherPlayers: z.array(otherPlayerParser),
  answerDeck: z.array(answerCardParser),
});

const joinGameParser = z.object({
  gameKey: z.string(),
  player: z.object({ id: z.string(), persona: humanPersonaParser }),
});

function normalizeHumanPersona(input: HumanPersonaInput) {
  return {
    id: input.id,
    name: input.name,
    personality: input.personality ?? "",
    likes: input.likes ?? [],
    dislikes: input.dislikes ?? [],
    humorStyle: input.humorStyle ?? [],
    favoriteJokeTypes: input.favoriteJokeTypes ?? [],
  };
}

const gameActionParser = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("PLAYER_PLAYED_ANSWER_CARD"),
    playerId: z.string(),
    cardId: z.string(),
  }),
  z.object({
    type: z.literal("RETURN_JUDGEMENT"),
    result: z.object({
      judgeId: z.string(),
      winningCardId: z.string(),
      winningPlayerId: z.string(),
      reactionToWinningCard: z.string().optional(),
    }),
  }),
]);

const tools: Tool[] = [
  {
    name: "start-game",
    title: "Start a Cards Against AI game",
    description:
      "Creates a new game instance and returns its gameId/gameKey. This tool only starts a game; there are no tools to deal, start rounds, submit cards, or advance gameplay. Once started, the server and widget control the round flow. If the user has not specified how many computer players they want, ask them: the game needs 3 additional players, and they can choose 0-3 CPU players (e.g. 1, 2, 3, all, none). They can also specify CPU personas; otherwise invent them. Rules summary: each round a judge reveals a prompt, all other players submit one answer card, the judge picks the funniest, then everyone draws back up and the judge rotates. Full rules are in rules://cards-against-ai. Provide 100 answer cards in answerDeck when possible; guidance and tone are in rules://cards-against-ai/answer-deck. CPU personas must include id, name, personality, likes, dislikes, humorStyle, and favoriteJokeTypes per the schema.",
    inputSchema: startGameInputSchema,
    _meta: toolDescriptorMeta(),
    annotations: {
      destructiveHint: false,
      openWorldHint: false,
      readOnlyHint: false,
    },
  },
  {
    name: "join-game",
    title: "Join a Cards Against AI game",
    description:
      "Joins an existing game by gameKey and returns its gameId/gameKey. This tool only joins a game; gameplay actions (dealing, starting rounds, submitting cards) are not tool-driven and are handled by the server/widget. Provide a player id and full persona per the schema; infer the persona from the user's context when possible so the game can tailor humor.",
    inputSchema: joinGameInputSchema,
    _meta: toolDescriptorMeta(),
    annotations: {
      destructiveHint: false,
      openWorldHint: false,
      readOnlyHint: false,
    },
  },
];

const resources: Resource[] = [
  {
    name: "Cards Against AI widget",
    uri: TEMPLATE_URI,
    description: "Cards Against AI widget markup",
    mimeType: MIME_TYPE,
    _meta: toolDescriptorMeta(),
  },
  {
    name: "Cards Against AI rules",
    uri: RULES_URI,
    description: "Cards Against AI game rules",
    mimeType: MARKDOWN_MIME_TYPE,
    _meta: toolDescriptorMeta(),
  },
  {
    name: "Cards Against AI answer deck guidance",
    uri: ANSWER_GUIDANCE_URI,
    description: "Guidance for crafting the answer deck",
    mimeType: MARKDOWN_MIME_TYPE,
    _meta: toolDescriptorMeta(),
  },
];

const resourceTemplates: ResourceTemplate[] = [
  {
    name: "Cards Against AI widget template",
    uriTemplate: TEMPLATE_URI,
    description: "Cards Against AI widget markup",
    mimeType: MIME_TYPE,
    _meta: toolDescriptorMeta(),
  },
  {
    name: "Cards Against AI rules template",
    uriTemplate: RULES_URI,
    description: "Cards Against AI game rules",
    mimeType: MARKDOWN_MIME_TYPE,
    _meta: toolDescriptorMeta(),
  },
  {
    name: "Cards Against AI answer deck guidance template",
    uriTemplate: ANSWER_GUIDANCE_URI,
    description: "Guidance for crafting the answer deck",
    mimeType: MARKDOWN_MIME_TYPE,
    _meta: toolDescriptorMeta(),
  },
];

function createCardsAgainstAiServer(): Server {
  const server = new Server(
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

  server.setRequestHandler(
    ListResourcesRequestSchema,
    async (_request: ListResourcesRequest) => ({
      resources,
    }),
  );

  server.setRequestHandler(
    ReadResourceRequestSchema,
    async (request: ReadResourceRequest) => {
      switch (request.params.uri) {
        case TEMPLATE_URI:
          return {
            contents: [
              {
                uri: TEMPLATE_URI,
                mimeType: MIME_TYPE,
                text: widgetHtml,
                _meta: toolDescriptorMeta(),
              },
            ],
          };
        case RULES_URI:
          return {
            contents: [
              {
                uri: RULES_URI,
                mimeType: MARKDOWN_MIME_TYPE,
                text: rulesMarkdown,
                _meta: toolDescriptorMeta(),
              },
            ],
          };
        case ANSWER_GUIDANCE_URI:
          return {
            contents: [
              {
                uri: ANSWER_GUIDANCE_URI,
                mimeType: MARKDOWN_MIME_TYPE,
                text: answerGuidanceMarkdown,
                _meta: toolDescriptorMeta(),
              },
            ],
          };
        default:
          throw new Error(`Unknown resource: ${request.params.uri}`);
      }
    },
  );

  server.setRequestHandler(
    ListResourceTemplatesRequestSchema,
    async (_request: ListResourceTemplatesRequest) => ({
      resourceTemplates,
    }),
  );

  server.setRequestHandler(
    ListToolsRequestSchema,
    async (_request: ListToolsRequest) => ({
      tools,
    }),
  );

  server.setRequestHandler(
    CallToolRequestSchema,
    async (request: CallToolRequest) => {
      switch (request.params.name) {
        case "start-game":
          return await startGame(request);
        case "join-game":
          return await joinGame(request);
        default:
          throw new Error(`Unknown tool: ${request.params.name}`);
      }
    },
  );

  return server;
}

async function startGame(request: CallToolRequest) {
  const args = startGameParser.parse(request.params.arguments ?? {});

  if (args.otherPlayers.length !== 3) {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: "Cards Against AI requires exactly 4 players.",
        },
      ],
      _meta: toolInvocationMeta("start-game"),
    };
  }

  const gameId = randomUUID();
  const otherPlayers = args.otherPlayers.map((player) =>
    player.type === "cpu"
      ? {
          type: "cpu" as const,
          persona: player.persona,
        }
      : { type: "human" as const },
  );
  const instance = new GameInstance({
    owner: {
      id: args.owner.id,
      persona: normalizeHumanPersona(args.owner.persona),
    },
    otherPlayers,
    answerDeck: args.answerDeck,
  });
  instance.initializeNewGame();

  const gameKey = instance.key;
  const record = { id: gameId, key: gameKey, instance };
  gamesById.set(gameId, record);
  gamesByKey.set(gameKey, record);

  return {
    content: [],
    structuredContent: {},
    _meta: {
      ...toolInvocationMeta("start-game"),
      gameId,
      gameKey,
    },
  };
}

async function joinGame(request: CallToolRequest) {
  const args = joinGameParser.parse(request.params.arguments ?? {});
  const record = gamesByKey.get(args.gameKey);
  const _meta = toolInvocationMeta("join-game");

  if (!record) {
    return {
      isError: true,
      content: [{ type: "text", text: "invalid game code" }],
      _meta,
    };
  }

  if (!record.instance.hasVacancy()) {
    return {
      isError: true,
      content: [{ type: "text", text: "server is full" }],
      _meta,
    };
  }

  const joined = record.instance.joinPlayer({
    id: args.player.id,
    persona: normalizeHumanPersona(args.player.persona),
  });
  if (!joined) {
    return {
      isError: true,
      content: [{ type: "text", text: "server is full" }],
      _meta,
    };
  }

  return {
    content: [],
    structuredContent: {},
    _meta: {
      ..._meta,
      gameId: record.id,
      gameKey: record.key,
    },
  };
}

interface SessionRecord {
  server: Server;
  transport: SSEServerTransport;
}

interface SessionQuery {
  sessionId?: string;
}

interface GameEventsParams {
  id: string;
}

const sessions = new Map<string, SessionRecord>();

async function handleSseRequest(
  req: IncomingMessage,
  res: ServerResponse,
) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const { path: requestPath, query } = parseRequestUrl(req);
  logMcpEvent("mcp.sse.request", {
    method: req.method ?? "GET",
    path: requestPath,
    query,
    headers: filterHeaders(req.headers),
  });

  const server = createCardsAgainstAiServer();
  const transport = new SSEServerTransport("/mcp/messages", res);
  const sessionId = transport.sessionId;

  sessions.set(sessionId, { server, transport });
  logMcpEvent("mcp.sse.session", { sessionId });

  transport.onclose = async () => {
    logMcpEvent("mcp.sse.closed", { sessionId });
    sessions.delete(sessionId);
    await server.close();
  };

  transport.onerror = (error) => {
    console.error("SSE transport error", error);
    logMcpEvent("mcp.sse.error", {
      sessionId,
      message: error instanceof Error ? error.message : String(error),
    });
  };

  try {
    await server.connect(transport);
  } catch (error) {
    sessions.delete(sessionId);
    console.error("Failed to start SSE session", error);
    if (!res.headersSent) {
      res.writeHead(500).end("Failed to establish SSE connection");
    }
  }
}

async function handlePostMessage(
  req: IncomingMessage,
  res: ServerResponse,
  sessionId: string | null,
  bodyText: string | null,
) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type");

  const { path: requestPath, query } = parseRequestUrl(req);

  logMcpEvent("mcp.messages.request", {
    method: req.method ?? "POST",
    path: requestPath,
    query,
    headers: filterHeaders(req.headers),
    sessionId,
  });

  if (MCP_LOG_ENABLED && bodyText !== null) {
    const bodyCapture = buildBodyCapture(bodyText, MCP_LOG_BODY_LIMIT);
    logMcpEvent("mcp.messages.body", {
      sessionId,
      byteLength: bodyCapture.byteLength,
      truncated: bodyCapture.truncated,
      body: bodyCapture.body,
    });
  }

  if (!sessionId) {
    logMcpEvent("mcp.messages.error", {
      sessionId: null,
      message: "Missing sessionId query parameter",
    });
    res.writeHead(400).end("Missing sessionId query parameter");
    return;
  }

  const session = sessions.get(sessionId);

  if (!session) {
    logMcpEvent("mcp.messages.error", {
      sessionId,
      message: "Unknown session",
    });
    res.writeHead(404).end("Unknown session");
    return;
  }

  try {
    const proxyReq = createProxyRequest(req, bodyText);
    await session.transport.handlePostMessage(proxyReq, res);
    logMcpEvent("mcp.messages.response", {
      sessionId,
      statusCode: res.statusCode,
    });
  } catch (error) {
    console.error("Failed to process message", error);
    logMcpEvent("mcp.messages.error", {
      sessionId,
      message: error instanceof Error ? error.message : String(error),
    });
    if (!res.headersSent) {
      res.writeHead(500).end("Failed to process message");
    }
  }
}

async function* createGameEventStream(
  record: GameRecord,
  signal: AbortSignal,
) {
  yield { event: "state", data: JSON.stringify(record.instance.getState()) };

  try {
    for await (const [state] of on(record.instance, "state-changed", { signal })) {
      yield { event: "state", data: JSON.stringify(state as GameState) };
    }
  } catch (error) {
    if (!signal.aborted) {
      throw error;
    }
  }
}

const portEnv = Number(process.env.PORT ?? 8000);
const port = Number.isFinite(portEnv) ? portEnv : 8000;

const app = fastify();
app.register(FastifySSEPlugin);
app.addContentTypeParser(
  ["application/json", "application/*+json"],
  { parseAs: "string" },
  (_request, body, done) => {
    done(null, body);
  },
);

app.addHook("onRequest", (request, _reply, done) => {
  requestTimings.set(request, Date.now());
  console.info(
    `[cards-ai http] --> ${request.method} ${request.url}`,
  );
  done();
});

app.addHook("onResponse", (request, reply, done) => {
  const startedAt = requestTimings.get(request);
  const durationMs =
    typeof startedAt === "number" ? Date.now() - startedAt : null;
  const durationLabel =
    durationMs === null ? "" : ` ${durationMs}ms`;
  const formattedBody = formatRequestBody(request.body);

  console.info(
    `[cards-ai http] <-- ${request.method} ${request.url} ${reply.statusCode}${durationLabel}`,
  );
  console.info(`[cards-ai http] body\n${formattedBody}`);
  done();
});

app.options("/mcp", (_request, reply) => {
  reply
    .header("Access-Control-Allow-Origin", "*")
    .header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    .header("Access-Control-Allow-Headers", "content-type")
    .code(204)
    .send();
});

app.options("/mcp/messages", (_request, reply) => {
  reply
    .header("Access-Control-Allow-Origin", "*")
    .header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
    .header("Access-Control-Allow-Headers", "content-type")
    .code(204)
    .send();
});

app.options("/game/:id/actions", (_request, reply) => {
  reply
    .header("Access-Control-Allow-Origin", "*")
    .header("Access-Control-Allow-Methods", "POST, OPTIONS")
    .header("Access-Control-Allow-Headers", "content-type")
    .code(204)
    .send();
});

app.get("/mcp", async (request, reply) => {
  reply.hijack();
  await handleSseRequest(request.raw, reply.raw);
});

app.post<{ Querystring: SessionQuery }>(
  "/mcp/messages",
  async (request, reply) => {
    const sessionId = request.query.sessionId ?? null;
    const bodyText = normalizeBodyText(request.body);
    reply.hijack();
    await handlePostMessage(request.raw, reply.raw, sessionId, bodyText);
  },
);

app.post<{ Params: GameEventsParams; Body: unknown }>(
  "/game/:id/actions",
  async (request, reply) => {
    const rawBody = request.body;
    let body: unknown = rawBody;
    if (typeof rawBody === "string") {
      try {
        body = JSON.parse(rawBody) as unknown;
      } catch {
        reply
          .header("Access-Control-Allow-Origin", "*")
          .code(400)
          .send({ error: "Invalid JSON body." });
        return;
      }
    }

    const parsed = gameActionParser.safeParse(body);
    if (!parsed.success) {
      reply
        .header("Access-Control-Allow-Origin", "*")
        .code(400)
        .send({ error: "Invalid game action payload." });
      return;
    }

    const record = gamesById.get(request.params.id);
    if (!record) {
      reply
        .header("Access-Control-Allow-Origin", "*")
        .code(404)
        .send({ error: "Unknown game id" });
      return;
    }

    try {
      switch (parsed.data.type) {
        case "PLAYER_PLAYED_ANSWER_CARD":
          record.instance.playAnswerCard(
            parsed.data.playerId,
            parsed.data.cardId,
          );
          break;
        case "RETURN_JUDGEMENT":
          record.instance.judgeAnswers(parsed.data.result);
          break;
        default:
          reply
            .header("Access-Control-Allow-Origin", "*")
            .code(400)
            .send({ error: "Unsupported game action." });
          return;
      }
    } catch (error) {
      reply
        .header("Access-Control-Allow-Origin", "*")
        .code(400)
        .send({
          error: error instanceof Error ? error.message : "Action failed.",
        });
      return;
    }

    reply.header("Access-Control-Allow-Origin", "*").code(200).send({
      ok: true,
    });
  },
);

app.get<{ Params: GameEventsParams }>(
  "/game/:id/events",
  async (request, reply) => {
    const record = gamesById.get(request.params.id);

    if (!record) {
      reply.code(404).type("text/plain").send("Unknown game id");
      return;
    }

    const abortController = new AbortController();
    const { signal } = abortController;

    request.raw.on("close", () => abortController.abort());
    request.raw.on("error", () => abortController.abort());

    reply
      .header("Access-Control-Allow-Origin", "*")
      .header("Cache-Control", "no-cache")
      .header("X-Accel-Buffering", "no");

    return reply.sse(createGameEventStream(record, signal));
  },
);

app.listen({ port }, (err) => {
  if (err) {
    console.error("Failed to start Cards Against AI server", err);
    process.exit(1);
  }

  console.log(
    `Cards Against AI MCP server listening on http://localhost:${port}`,
  );
  console.log(`  SSE stream: GET http://localhost:${port}/mcp`);
  console.log(
    `  Message post endpoint: POST http://localhost:${port}/mcp/messages?sessionId=...`,
  );
  console.log(
    `  Event stream (SSE): http://localhost:${port}/game/{id}/events`,
  );
});
