import type { KeyboardEvent } from "react";
import { Send, CalendarDays } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function CoachComposer({
  draft,
  onDraftChange,
  onSend,
  onGeneratePlan,
  sendBlocked,
  error,
}: {
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onGeneratePlan?: () => void;
  sendBlocked: boolean;
  error: string | null;
}) {
  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onSend();
    }
  }

  return (
    <div className="shrink-0 border-t border-border/70 bg-background-alt/40 px-4 pb-3 pt-3 sm:px-7 lg:px-10">
      <div className="mx-auto w-full max-w-[780px]">
        {error && <p role="alert" className="mb-2 text-sm text-destructive">{error}</p>}
        <div className="flex items-end gap-2 rounded-xl border border-border bg-card px-2 py-2 shadow-[0_2px_14px_rgba(0,0,0,0.025)] focus-within:border-primary/50">
          <Textarea aria-label="Message your coach" value={draft} onChange={event => onDraftChange(event.target.value)} onKeyDown={onKeyDown} placeholder="Ask about technique, skills, or your training…" rows={1} className="min-h-10 max-h-36 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-2 py-2.5 leading-5 shadow-none focus-visible:border-0 focus-visible:ring-0" />
          <Button size="icon" className="mb-0.5 size-9 shrink-0" aria-label="Send message" onClick={onSend} disabled={!draft.trim() || sendBlocked}><Send className="size-4" /></Button>
        </div>
        {onGeneratePlan && <Button variant="outline" size="sm" className="mt-2" onClick={onGeneratePlan} disabled={!draft.trim() || sendBlocked}><CalendarDays className="size-4" />Generate weekly plan</Button>}
        <p className="mt-2 text-[11px] leading-4 text-foreground-faint">Enter to send · Shift+Enter for a new line · Guidance is educational</p>
      </div>
    </div>
  );
}
