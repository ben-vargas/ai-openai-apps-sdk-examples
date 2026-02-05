import { useState } from "react";
import { useGameState } from "./game-management";
import { PipLayout } from "./PipLayout";
import { SplashScreen } from "./SplashScreen";

export function CardsAgainstAiGame() {
  const [gameStarted, setGameStarted] = useState(false);
  const gameState = useGameState();

  if (!gameStarted) {
    return (
      <SplashScreen
        status={gameState.status}
        onStart={() => setGameStarted(true)}
      />
    );
  }

  return <PipLayout />;
}
