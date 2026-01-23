import type { IncomingMessage, ServerResponse } from "node:http";

interface McpServerOptions {
  name: string;
  version: string;
}

declare module "@modelcontextprotocol/sdk/server/mcp.js" {
  export class McpServer {
    constructor(options: McpServerOptions);
    registerResource(name: string, uri: string, meta: unknown, handler: () => Promise<unknown>): void;
    registerTool(
      name: string,
      descriptor: unknown,
      handler: (args: unknown) => Promise<unknown>,
    ): void;
    connect(transport: unknown): Promise<void>;
  }
}

declare module "@modelcontextprotocol/sdk/server/streamableHttp.js" {
  export class StreamableHTTPServerTransport {
    handleRequest(
      req: IncomingMessage,
      res: ServerResponse<IncomingMessage>,
    ): Promise<void>;
  }
}
