import type { KeyboardEvent } from "react";
import Link from "next/link";
import { Send, CalendarDays } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { CoachUsage } from "./types";

/** Only a metered (Free) allowance is shown; unlimited Pro access shows nothing. */
export function limitedAllowance(usage: CoachUsage | null) {
  if (!usage || usage.unlimited || usage.limit === null || usage.remaining === null) return null;
  return { limit: usage.limit, remaining: usage.remaining, resetsAt: usage.resets_at };
}

function resetTime(value: string | null) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }).format(date);
}

export function CoachComposer({
  draft,
  onDraftChange,
  onSend,
  onGeneratePlan,
  sendBlocked,
  error,
  usage = null,
}: {
  draft: string;
  onDraftChange: (value: string) => void;
  onSend: () => void;
  onGeneratePlan?: () => void;
  sendBlocked: boolean;
  error: string | null;
  usage?: CoachUsage | null;
}) {
  const allowance = limitedAllowance(usage);
  const exhausted = allowance?.remaining === 0;
  const resets = resetTime(allowance?.resetsAt ?? null);

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      onSend();
    }
  }

  return (
    <div className="shrink-0 border-t border-border/70 bg-background-alt/40 px-4 pb-3 pt-3 sm:px-7 lg:px-10">
      <div className="mx-auto w-full max-w-[780px]">
        {exhausted && allowance && (
          <Alert role="status" className="mb-2">
            <AlertTitle>Today&apos;s AI Coach messages are used</AlertTitle>
            <AlertDescription>
              You&apos;ve used today&apos;s {allowance.limit} AI Coach messages. Your Free allowance resets{resets ? ` ${resets}` : " tomorrow"}, or you can upgrade to Pro for continued access.{" "}
              <Link href="/dashboard/settings" className="font-medium text-primary">View Pro</Link>
            </AlertDescription>
          </Alert>
        )}
        {error && <p role="alert" className="mb-2 text-sm text-destructive">{error}</p>}
        <div className="flex items-end gap-2 rounded-xl border border-border bg-card px-2 py-2 shadow-[0_2px_14px_rgba(0,0,0,0.025)] focus-within:border-primary/50">
          <Textarea aria-label="Message your coach" value={draft} onChange={event => onDraftChange(event.target.value)} onKeyDown={onKeyDown} placeholder="Ask about technique, skills, or your training…" rows={1} className="min-h-10 max-h-36 flex-1 resize-none overflow-y-auto border-0 bg-transparent px-2 py-2.5 leading-5 shadow-none focus-visible:border-0 focus-visible:ring-0" />
          <Button size="icon" className="mb-0.5 size-9 shrink-0" aria-label="Send message" onClick={onSend} disabled={!draft.trim() || sendBlocked}><Send className="size-4" /></Button>
        </div>
        {onGeneratePlan && <Button variant="outline" size="sm" className="mt-2" onClick={onGeneratePlan} disabled={!draft.trim() || sendBlocked}><CalendarDays className="size-4" />Generate weekly plan</Button>}
        <p className="mt-2 flex flex-wrap justify-between gap-x-4 gap-y-1 text-[11px] leading-4 text-foreground-faint">
          <span>Enter to send · Shift+Enter for a new line · Guidance is educational</span>
          {allowance && <span data-testid="coach-allowance">{allowance.remaining} of {allowance.limit} messages remaining today</span>}
        </p>
      </div>
    </div>
  );
}
