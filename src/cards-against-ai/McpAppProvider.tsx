import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
} from "react";
import { useApp } from "@modelcontextprotocol/ext-apps/react";
import type { App, McpUiToolResultNotification } from "@modelcontextprotocol/ext-apps/react";
import type { GameState } from "./types";

type ToolResult = McpUiToolResultNotification["params"];

export interface ToolResultData {
  gameId?: string;
  gameKey?: string;
  gameState?: GameState;
  invocation?: string;
  [key: string]: unknown;
}

interface McpAppContextValue {
  app: App | null;
  isConnected: boolean;
  toolResult: ToolResult | null;
  toolResultData: ToolResultData | null;
  toolInput: Record<string, unknown> | null;
  updateToolResultData: (data: ToolResultData) => void;
}

const McpAppContext = createContext<McpAppContextValue | null>(null);

interface McpAppProviderProps {
  children: React.ReactNode;
}

export function McpAppProvider({ children }: McpAppProviderProps) {
  const [toolResult, setToolResult] = useState<ToolResult | null>(null);
  const [toolResultData, setToolResultData] = useState<ToolResultData | null>(null);
  const [toolInput, setToolInput] = useState<Record<string, unknown> | null>(null);

  const onAppCreated = useCallback((app: App) => {
    app.ontoolinput = (params) => {
      setToolInput((params.arguments as Record<string, unknown>) ?? null);
    };

    app.ontoolresult = (params) => {
      setToolResult(params);
      const data = (params.structuredContent as ToolResultData | undefined) ?? null;
      setToolResultData(data);
    };
  }, []);

  const { app, isConnected } = useApp({
    appInfo: { name: "cards-against-ai", version: "1.0.0" },
    capabilities: {},
    onAppCreated,
  });

  const updateToolResultData = useCallback((data: ToolResultData) => {
    setToolResultData(data);
  }, []);

  const contextValue = useMemo(
    () => ({ app, isConnected, toolResult, toolResultData, toolInput, updateToolResultData }),
    [app, isConnected, toolResult, toolResultData, toolInput, updateToolResultData],
  );

  return (
    <McpAppContext.Provider value={contextValue}>
      {children}
    </McpAppContext.Provider>
  );
}

const noop = () => {};

const DEFAULT_CONTEXT: McpAppContextValue = {
  app: null,
  isConnected: false,
  toolResult: null,
  toolResultData: null,
  toolInput: null,
  updateToolResultData: noop,
};

export function useMcpApp(): McpAppContextValue {
  const ctx = useContext(McpAppContext);
  return ctx ?? DEFAULT_CONTEXT;
}
