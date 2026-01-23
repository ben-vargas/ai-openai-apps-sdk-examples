import type { PromptCard } from "./types";

interface PromptProps {
  prompt: PromptCard | null;
}

const Prompt = ({ prompt }: PromptProps) => (
  <div className="rounded-xl border border-slate-300 bg-white p-4 text-center shadow-sm dark:border-slate-700 dark:bg-slate-900">
    <div className="text-xs font-semibold uppercase text-slate-500 dark:text-slate-400">
      Prompt
    </div>
    <div className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">
      {prompt?.text ?? "No prompt yet."}
    </div>
  </div>
);

export default Prompt;
