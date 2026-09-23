import { RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CoachMarkdown } from "./coach-markdown";
import { PlanPreviewCard } from "./plan-preview";
import type { CoachMessage } from "./types";

export type DisplayMessage = CoachMessage & { delivery?: "sending" | "accepted" | "failed" };

export function CoachMessageRow({ message, onRetry }: { message: DisplayMessage; onRetry?: () => void }) {
  const athlete = message.role === "user";
  return (
    <article className={`grid gap-3 sm:grid-cols-[112px_minmax(0,1fr)] sm:gap-5 ${athlete ? "border-t border-border/60 py-5" : "pb-8 pt-1"}`} data-message-id={message.id}>
      <div className={`pt-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.13em] ${athlete ? "text-foreground-faint" : "text-primary"}`}>
        {athlete ? "You" : "Open Ascent Coach"}
      </div>
      <div className="min-w-0">
        {athlete ? (
          <div className="inline-block max-w-full rounded-[4px_16px_16px_16px] border border-primary/20 bg-primary-light/60 px-4 py-2.5 text-[15px] leading-6 text-foreground">
            <p className="whitespace-pre-wrap break-words">{message.content}</p>
          </div>
        ) : message.content ? (
          <CoachMarkdown content={message.content} />
        ) : (
          <p className="flex items-center gap-2 text-sm text-foreground-faint">
            {message.status === "streaming" ? <><span className="size-1.5 animate-pulse rounded-full bg-primary" />Thinking…</> : "No response was saved."}
          </p>
        )}
        {!athlete && message.plan_preview_id && <PlanPreviewCard previewId={message.plan_preview_id} />}
        {message.delivery === "sending" && <p className="mt-1 text-xs text-foreground-faint">Sending…</p>}
        {message.delivery === "accepted" && <p className="mt-1 text-xs text-foreground-faint">Saving response…</p>}
        {message.delivery === "failed" && (
          <div className="mt-2 flex items-center gap-3 text-xs text-destructive">
            <span>Delivery was not confirmed.</span>
            {onRetry && <Button variant="link" size="xs" className="h-auto p-0 text-destructive" onClick={onRetry}><RotateCcw className="size-3" />Retry safely</Button>}
          </div>
        )}
        {!athlete && message.status === "streaming" && message.content && <span className="mt-3 inline-block size-1.5 animate-pulse rounded-full bg-primary" aria-label="Streaming response" />}
        {!athlete && (message.status === "failed" || message.status === "interrupted") && (
          <p className="mt-3 border-l-2 border-destructive/50 pl-3 text-sm text-foreground-soft">
            {message.status === "interrupted" ? "This response was interrupted. Any partial text is saved. Send a new message when ready." : "The coach could not complete this response. You can send a new message."}
          </p>
        )}
      </div>
    </article>
  );
}
