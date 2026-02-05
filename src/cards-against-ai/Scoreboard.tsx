import { useMemo } from "react";
import type { Player } from "./types";

interface ScoreboardProps {
  players: Player[];
  currentJudgePlayerIndex: number;
  localPlayerId: string | null;
}

export function Scoreboard({
  players,
  currentJudgePlayerIndex,
  localPlayerId,
}: ScoreboardProps) {
  const sortedPlayers = useMemo(() => {
    const entries = players.map((player, index) => ({
      player,
      originalIndex: index,
    }));
    entries.sort(
      (a, b) =>
        b.player.wonPromptCards.length - a.player.wonPromptCards.length,
    );
    return entries;
  }, [players]);

  return (
    <div className="flex flex-col gap-1 px-3 py-2">
      <div className="text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
        Scoreboard
      </div>
      {sortedPlayers.map(({ player, originalIndex }) => {
        const isJudge = originalIndex === currentJudgePlayerIndex;
        const isLocal = player.id === localPlayerId;
        const name =
          player.persona?.name ?? (isLocal ? "You" : "Vacant");
        const wins = player.wonPromptCards.length;

        return (
          <div
            key={player.id || `vacant-${originalIndex}`}
            className={`flex items-center gap-2 text-xs ${
              isLocal
                ? "font-bold text-slate-900 dark:text-slate-100"
                : "text-slate-700 dark:text-slate-300"
            }`}
          >
            <span className="w-4 text-center">
              {isJudge ? "\u2696\uFE0F" : ""}
            </span>
            <span className="flex-1 truncate">{name}</span>
            <span className="tabular-nums text-slate-500 dark:text-slate-400">
              {wins} {wins === 1 ? "win" : "wins"}
            </span>
          </div>
        );
      })}
    </div>
  );
}
