export function TypingIndicator() {
  return (
    <div className="mr-auto flex max-w-[80%] items-center gap-2 rounded-2xl border border-slate-700/40 bg-slate-800/40 px-4 py-3">
      <div className="flex gap-1">
        <span className="typing-dot h-2 w-2 rounded-full bg-zinc-400" />
        <span className="typing-dot h-2 w-2 rounded-full bg-zinc-400" />
        <span className="typing-dot h-2 w-2 rounded-full bg-zinc-400" />
      </div>
      <span className="text-xs text-zinc-500">Sharks are thinking...</span>
    </div>
  );
}
