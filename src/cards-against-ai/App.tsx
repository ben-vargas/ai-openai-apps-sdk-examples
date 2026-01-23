import { useEffect, useMemo, useRef } from "react";
import { CardManagementProvider } from "./card-management";
import { GameManagementProvider } from "./game-management";
import { CardsAgainstAiGame } from "./CardsAgainstAiGame";
import { useOpenAiGlobal } from "../use-openai-global";
import { useWidgetProps } from "../use-widget-props";

interface CardsAgainstAiToolOutput {
  gameId?: string;
  gameKey?: string;
}

interface CardsAgainstAiToolResponseMetadata {
  gameId?: string;
  gameKey?: string;
}

interface PlayerIdPayload {
  id?: string;
}

interface CardsAgainstAiWidgetState {
  gameId?: string;
  gameKey?: string;
}

function safeSerialize(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function buildToolInputSignature(toolInput: Record<string, unknown> | null): string {
  if (!toolInput) {
    return "empty";
  }

  const owner = toolInput.owner as PlayerIdPayload | undefined;
  const player = toolInput.player as PlayerIdPayload | undefined;
  const otherPlayers = Array.isArray(toolInput.otherPlayers)
    ? toolInput.otherPlayers.length
    : 0;
  const answerDeck = Array.isArray(toolInput.answerDeck)
    ? toolInput.answerDeck.length
    : 0;

  return [
    owner?.id ?? "no-owner",
    player?.id ?? "no-player",
    otherPlayers,
    answerDeck,
  ].join("|");
}

if (import.meta.env.DEV) {
  void import("./dev-helper").then((module) =>
    module.initCardsAgainstAiDevHelper(),
  );
}

export default function App() {
  const toolOutput = useWidgetProps(() => ({})) as CardsAgainstAiToolOutput | null;
  const toolResponseMetadata = useOpenAiGlobal(
    "toolResponseMetadata",
  ) as CardsAgainstAiToolResponseMetadata | null;
  const toolInput = useOpenAiGlobal("toolInput") as Record<string, unknown> | null;
  const widgetState = useOpenAiGlobal("widgetState") as
    | CardsAgainstAiWidgetState
    | null;
  const lastWidgetSyncRef = useRef<CardsAgainstAiWidgetState | null>(null);
  const lastToolInputSignatureRef = useRef<string | null>(null);
  const lastToolOutputSignatureRef = useRef<string | null>(null);
  const lastToolResponseMetadataSignatureRef = useRef<string | null>(null);
  const lastWidgetStateSignatureRef = useRef<string | null>(null);

  const localPlayerId = useMemo(() => {
    if (!toolInput) {
      return null;
    }
    
    const owner = toolInput.owner as PlayerIdPayload | undefined;
    if (owner?.id) {
      return owner.id;
    }

    const player = toolInput.player as PlayerIdPayload | undefined;
    if (player?.id) {
      return player.id;
    }
    return null;
  }, [toolInput]);

  useEffect(() => {
    const signature = buildToolInputSignature(toolInput);
    if (signature === lastToolInputSignatureRef.current) {
      return;
    }
    lastToolInputSignatureRef.current = signature;
    if (toolInput) {
      console.info("[cards-ai] tool input", toolInput);
    } else {
      console.info("[cards-ai] tool input missing");
    }
  }, [toolInput]);

  useEffect(() => {
    const signature = safeSerialize(toolOutput);
    if (signature === lastToolOutputSignatureRef.current) {
      return;
    }
    lastToolOutputSignatureRef.current = signature;
    console.info("[cards-ai] tool output", toolOutput);
  }, [toolOutput]);

  useEffect(() => {
    const signature = safeSerialize(toolResponseMetadata);
    if (signature === lastToolResponseMetadataSignatureRef.current) {
      return;
    }
    lastToolResponseMetadataSignatureRef.current = signature;
    console.info("[cards-ai] tool response metadata", toolResponseMetadata);
  }, [toolResponseMetadata]);

  useEffect(() => {
    const signature = safeSerialize(widgetState);
    if (signature === lastWidgetStateSignatureRef.current) {
      return;
    }
    lastWidgetStateSignatureRef.current = signature;
    console.info("[cards-ai] widget state", widgetState);
  }, [widgetState]);

  const resolvedToolPayload = useMemo(() => {
    if (toolOutput?.gameId || toolOutput?.gameKey) {
      return toolOutput;
    }
    return toolResponseMetadata;
  }, [toolOutput, toolResponseMetadata]);

  useEffect(() => {
    if (!resolvedToolPayload?.gameId || !resolvedToolPayload?.gameKey) {
      return;
    }

    const setWidgetState = window.openai?.setWidgetState;
    if (!setWidgetState) {
      return;
    }

    const alreadySynced =
      lastWidgetSyncRef.current?.gameId === resolvedToolPayload.gameId &&
      lastWidgetSyncRef.current?.gameKey === resolvedToolPayload.gameKey;

    const shouldUpdate =
      widgetState?.gameId !== resolvedToolPayload.gameId ||
      widgetState?.gameKey !== resolvedToolPayload.gameKey;

    if (!shouldUpdate || alreadySynced) {
      return;
    }

    lastWidgetSyncRef.current = {
      gameId: resolvedToolPayload.gameId,
      gameKey: resolvedToolPayload.gameKey,
    };

    const nextState = {
      ...(widgetState ?? {}),
      gameId: resolvedToolPayload.gameId,
      gameKey: resolvedToolPayload.gameKey,
    };

    void setWidgetState(nextState);
  }, [
    resolvedToolPayload?.gameId,
    resolvedToolPayload?.gameKey,
    widgetState?.gameId,
    widgetState?.gameKey,
  ]);

  const resolvedGameId =
    resolvedToolPayload?.gameId ?? widgetState?.gameId ?? null;
  const resolvedGameKey =
    resolvedToolPayload?.gameKey ?? widgetState?.gameKey ?? null;

  return (
    <div className="h-screen w-screen overflow-auto bg-slate-50 px-4 py-3 text-slate-900 dark:bg-slate-950 dark:text-slate-100">
      <GameManagementProvider
        gameId={resolvedGameId}
        gameKey={resolvedGameKey}
        localPlayerId={localPlayerId}
      >
        <CardManagementProvider>
          <CardsAgainstAiGame />
        </CardManagementProvider>
      </GameManagementProvider>
    </div>
  );
}
