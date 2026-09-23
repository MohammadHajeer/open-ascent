import { useLayoutEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CoachMessageRow, type DisplayMessage } from "./coach-message";

export function MessageList({ messages, onRetry }: { messages: DisplayMessage[]; onRetry?: () => void }) {
  const viewport = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const [showLatest, setShowLatest] = useState(false);
  const last = messages.at(-1);

  useLayoutEffect(() => {
    const node = viewport.current;
    if (node && follow.current) node.scrollTop = node.scrollHeight;
  }, [messages.length, last?.content, last?.status]);

  function handleScroll() {
    const node = viewport.current;
    if (!node) return;
    follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 96;
    setShowLatest(!follow.current);
  }

  function jumpToLatest() {
    const node = viewport.current;
    if (!node) return;
    follow.current = true;
    setShowLatest(false);
    node.scrollTop = node.scrollHeight;
  }

  return (
    <div className="relative flex min-h-0 flex-1">
      <div ref={viewport} onScroll={handleScroll} aria-label="Message history" className="coach-scroll min-h-0 w-full overflow-y-auto overscroll-contain px-4 py-4 sm:px-7 lg:px-10">
        <div className="mx-auto w-full max-w-[780px] pb-4">
          {messages.map(message => <CoachMessageRow key={message.id} message={message} onRetry={message.delivery === "failed" ? onRetry : undefined} />)}
        </div>
      </div>
      {showLatest && <Button variant="secondary" size="sm" className="absolute bottom-3 right-5 z-10 border border-border shadow-sm" onClick={jumpToLatest}><ArrowDown className="size-3.5" />Jump to latest</Button>}
    </div>
  );
}
