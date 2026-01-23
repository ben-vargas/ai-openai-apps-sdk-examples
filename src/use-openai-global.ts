import { useSyncExternalStore } from "react";
import {
  SET_GLOBALS_EVENT_TYPE,
  SetGlobalsEvent,
  type OpenAiGlobals,
} from "./types";

const cachedGlobals: Partial<OpenAiGlobals> = {};

function readOpenAiGlobal<K extends keyof OpenAiGlobals>(
  key: K,
): OpenAiGlobals[K] | undefined {
  if (typeof window === "undefined") {
    return undefined;
  }

  const fromWindow = window.openai?.[key];
  if (fromWindow !== undefined) {
    cachedGlobals[key] = fromWindow;
    return fromWindow;
  }

  const hasCached = Object.prototype.hasOwnProperty.call(cachedGlobals, key);
  if (!hasCached) {
    return undefined;
  }

  return cachedGlobals[key] as OpenAiGlobals[K];
}

export function useOpenAiGlobal<K extends keyof OpenAiGlobals>(
  key: K
): OpenAiGlobals[K] | null {
  return useSyncExternalStore(
    (onChange) => {
      if (typeof window === "undefined") {
        return () => {};
      }

      let lastValue = readOpenAiGlobal(key);
      let pollId: number | null = null;

      const handleSetGlobal = (event: SetGlobalsEvent) => {
        const value = event.detail.globals[key];
        if (value === undefined) {
          return;
        }

        if (Object.is(lastValue, value)) {
          return;
        }

        cachedGlobals[key] = value as OpenAiGlobals[K];
        lastValue = value as OpenAiGlobals[K];
        onChange();
      };

      window.addEventListener(SET_GLOBALS_EVENT_TYPE, handleSetGlobal, {
        passive: true,
      });

      if (lastValue === undefined) {
        let remainingChecks = 40;
        pollId = window.setInterval(() => {
          const nextValue = readOpenAiGlobal(key);
          if (nextValue === undefined) {
            remainingChecks -= 1;
            if (remainingChecks <= 0 && pollId != null) {
              window.clearInterval(pollId);
              pollId = null;
            }
            return;
          }
          if (Object.is(lastValue, nextValue)) {
            return;
          }
          lastValue = nextValue;
          onChange();
          if (pollId != null) {
            window.clearInterval(pollId);
            pollId = null;
          }
        }, 250);
      }

      return () => {
        window.removeEventListener(SET_GLOBALS_EVENT_TYPE, handleSetGlobal);
        if (pollId != null) {
          window.clearInterval(pollId);
        }
      };
    },
    () => readOpenAiGlobal(key) ?? null,
    () => readOpenAiGlobal(key) ?? null
  );
}
