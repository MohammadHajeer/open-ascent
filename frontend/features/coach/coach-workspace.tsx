"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Menu } from "lucide-react";
import { ThemedAsset } from "@/components/shared/themed-asset";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { assets } from "@/lib/assets";
import {
  deleteConversation,
  getConversation,
  listConversations,
  renameConversation,
  sendFirstMessage,
  sendMessage,
  streamGeneration,
} from "./api";
import { CoachComposer } from "./coach-composer";
import { CoachHistoryLoading } from "./coach-loading";
import type { DisplayMessage } from "./coach-message";
import { ConversationSidebar } from "./conversation-sidebar";
import { MessageList } from "./message-list";
import type { Conversation, ConversationDetail, Generation } from "./types";
import { useCoachReveal } from "./use-coach-reveal";

const suggestions = [
  "Help me improve my Pull-Ups",
  "Build a Front Lever progression",
  "How should I structure my training week?",
];
const terminal = (status: Generation["status"]) =>
  ["completed", "failed", "interrupted"].includes(status);

type PendingSend = {
  requestId: string;
  content: string;
  conversationId: string | null;
  generationId: string | null;
  phase: "sending" | "accepted" | "failed";
  kind: "chat" | "plan";
};

export function CoachWorkspace() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<ConversationDetail | null>(null);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState<PendingSend | null>(null);
  const [streamSnapshot, setStreamSnapshot] = useState<Generation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [detailLoadingId, setDetailLoadingId] = useState<string | null>(null);
  const sending = useRef(false);
  const selectedRef = useRef<string | null>(null);
  const selectionRevision = useRef(0);
  // A list refresh already in flight must not resurrect a deleted conversation.
  const deletedIds = useRef(new Set<string>());

  useEffect(() => {
    const viewport = window.visualViewport;
    const updateHeight = () => {
      document.documentElement.style.setProperty(
        "--coach-viewport-height",
        `${viewport?.height ?? window.innerHeight}px`,
      );
    };
    updateHeight();
    viewport?.addEventListener("resize", updateHeight);
    window.addEventListener("resize", updateHeight);
    return () => {
      viewport?.removeEventListener("resize", updateHeight);
      window.removeEventListener("resize", updateHeight);
      document.documentElement.style.removeProperty("--coach-viewport-height");
    };
  }, []);

  const refreshList = useCallback(async () => {
    const items = await listConversations();
    setConversations(items.filter((item) => !deletedIds.current.has(item.id)));
  }, []);

  useEffect(() => {
    let live = true;
    listConversations()
      .then((items) => {
        if (!live) return;
        setConversations(items);
        setInitialLoading(false);
        if (selectionRevision.current) return;
        const remembered = window.localStorage.getItem(
          "open-ascent-coach-conversation",
        );
        const id =
          remembered && items.some((item) => item.id === remembered)
            ? remembered
            : (items[0]?.id ?? null);
        selectedRef.current = id;
        setDetailLoadingId(id);
        setSelected(id);
      })
      .catch((cause) => {
        if (live) {
          setInitialLoading(false);
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not load conversations.",
          );
        }
      });
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (!selected) return;
    let live = true;
    window.localStorage.setItem("open-ascent-coach-conversation", selected);
    getConversation(selected)
      .then((value) => {
        if (live) {
          setDetail(value);
          setDetailLoadingId(null);
        }
      })
      .catch((cause) => {
        if (live) {
          setDetailLoadingId(null);
          setError(
            cause instanceof Error
              ? cause.message
              : "Could not open conversation.",
          );
        }
      });
    return () => {
      live = false;
    };
  }, [selected]);

  function selectConversation(id: string | null) {
    selectionRevision.current += 1;
    selectedRef.current = id;
    setSelected(id);
    setDetail(null);
    setInitialLoading(false);
    setDetailLoadingId(id);
    setPending(null);
    setStreamSnapshot(null);
    setError(null);
    setMobileOpen(false);
    if (!id) window.localStorage.removeItem("open-ascent-coach-conversation");
  }

  const pendingHere = pending?.conversationId === selected ? pending : null;
  const savedMessages = detail?.id === selected ? detail.messages : [];
  const lastSaved = savedMessages.at(-1);
  const activeGeneration =
    pendingHere?.phase === "accepted" && pendingHere.generationId
      ? pendingHere.generationId
      : lastSaved?.role === "assistant" && lastSaved.status === "streaming"
        ? lastSaved.generation_id
        : null;
  const activeSnapshot =
    streamSnapshot?.id === activeGeneration ? streamSnapshot : null;
  const initialStreamText =
    lastSaved?.generation_id === activeGeneration ? lastSaved.content : "";
  const displayedStreamText = useCoachReveal(
    selected && activeGeneration ? `${selected}:${activeGeneration}` : null,
    activeSnapshot?.content ?? initialStreamText,
    activeSnapshot?.status ?? "streaming",
    initialStreamText,
  );

  useEffect(() => {
    if (!selected || !activeGeneration) return;
    const conversationId = selected;
    const generationId = activeGeneration;
    const controller = new AbortController();
    streamGeneration(
      conversationId,
      generationId,
      (value) => {
        if (selectedRef.current !== conversationId) return;
        setStreamSnapshot(value);
        if (terminal(value.status)) {
          void getConversation(conversationId)
            .then((fresh) => {
              if (selectedRef.current !== conversationId) return;
              setDetail(fresh);
              setPending((current) =>
                current?.generationId === generationId ? null : current,
              );
              setStreamSnapshot(null);
              void refreshList();
            })
            .catch((cause) =>
              setError(
                cause instanceof Error
                  ? cause.message
                  : "Could not refresh the saved response.",
              ),
            );
        }
      },
      controller.signal,
    ).catch((cause) => {
      if (
        !controller.signal.aborted &&
        selectedRef.current === conversationId
      ) {
        setError(
          cause instanceof Error
            ? cause.message
            : "Stream disconnected. Reconnect to the saved response.",
        );
      }
    });
    return () => controller.abort();
  }, [selected, activeGeneration, refreshList]);

  async function submit(
    value = draft,
    retry?: PendingSend,
    kind: "chat" | "plan" = "chat",
  ) {
    const content = value.trim();
    if (
      !content ||
      sending.current ||
      (pending && !retry) ||
      (activeGeneration && !retry)
    )
      return;
    sending.current = true;
    setInitialLoading(false);
    selectionRevision.current += 1;
    const revision = selectionRevision.current;
    const originalId = retry?.conversationId ?? selectedRef.current;
    const requestId = retry?.requestId ?? crypto.randomUUID();
    const optimistic: PendingSend = {
      requestId,
      content,
      conversationId: originalId,
      generationId: null,
      phase: "sending",
      kind: retry?.kind ?? kind,
    };
    setPending(optimistic);
    setStreamSnapshot(null);
    setError(null);
    if (!retry) setDraft("");
    try {
      let conversationId: string;
      let generationId: string;
      if (originalId) {
        const result = await sendMessage(
          originalId,
          content,
          requestId,
          optimistic.kind,
        );
        conversationId = originalId;
        generationId = result.generation_id;
      } else {
        const result = await sendFirstMessage(
          content,
          requestId,
          optimistic.kind,
        );
        conversationId = result.conversation.id;
        generationId = result.generation_id;
        setConversations((items) =>
          items.some((item) => item.id === conversationId)
            ? items
            : [result.conversation, ...items],
        );
      }
      if (
        selectionRevision.current === revision &&
        selectedRef.current === originalId
      ) {
        if (!originalId) {
          selectedRef.current = conversationId;
          setSelected(conversationId);
          setDetailLoadingId(conversationId);
        }
        setPending({
          ...optimistic,
          conversationId,
          generationId,
          phase: "accepted",
        });
        void getConversation(conversationId)
          .then((fresh) => {
            if (selectedRef.current !== conversationId) return;
            setDetail(fresh);
            setDetailLoadingId(null);
            const reply = fresh.messages.find(
              (message) => message.generation_id === generationId,
            );
            if (reply && terminal(reply.status)) {
              setPending(null);
              setStreamSnapshot(null);
            }
          })
          .catch((cause) =>
            setError(
              cause instanceof Error
                ? cause.message
                : "Could not load the saved message.",
            ),
          );
      }
      void refreshList();
    } catch (cause) {
      if (
        selectionRevision.current === revision &&
        selectedRef.current === originalId
      ) {
        setPending({ ...optimistic, phase: "failed" });
        setError(
          cause instanceof Error
            ? cause.message
            : "Could not confirm delivery. Retry using the same request.",
        );
      }
    } finally {
      sending.current = false;
    }
  }

  async function rename(id: string, title: string) {
    const updated = await renameConversation(id, title);
    setConversations((items) =>
      items.map((item) => (item.id === id ? updated : item)),
    );
    setDetail((current) =>
      current?.id === id ? { ...current, title: updated.title } : current,
    );
  }

  async function remove(id: string) {
    await deleteConversation(id);
    deletedIds.current.add(id);
    const index = conversations.findIndex((item) => item.id === id);
    const remaining = conversations.filter((item) => item.id !== id);
    setConversations((items) => items.filter((item) => item.id !== id));
    if (selectedRef.current === id) {
      // Open the neighbour that moved into its place, or the empty New chat.
      selectConversation(
        remaining[Math.min(index, remaining.length - 1)]?.id ?? null,
      );
    }
  }

  const messages: DisplayMessage[] = savedMessages.map((message) =>
    activeSnapshot?.id === message.generation_id
      ? {
          ...message,
          content: displayedStreamText,
          status: terminal(activeSnapshot.status)
            ? (activeSnapshot.status as DisplayMessage["status"])
            : "streaming",
        }
      : message,
  );
  const pendingConfirmed = Boolean(
    pendingHere?.generationId &&
    messages.some(
      (message) => message.generation_id === pendingHere.generationId,
    ),
  );
  if (pendingHere && !pendingConfirmed) {
    messages.push({
      id: `pending-user-${pendingHere.requestId}`,
      role: "user",
      content: pendingHere.content,
      status: "streaming",
      created_at: new Date().toISOString(),
      generation_id: null,
      plan_preview_id: null,
      delivery: pendingHere.phase,
    });
    if (pendingHere.phase !== "failed") {
      messages.push({
        id: `pending-coach-${pendingHere.requestId}`,
        role: "assistant",
        content:
          activeSnapshot?.id === pendingHere.generationId
            ? displayedStreamText
            : "",
        status: "streaming",
        created_at: new Date().toISOString(),
        generation_id: pendingHere.generationId,
        plan_preview_id: null,
      });
    }
  }

  const sendBlocked = Boolean(pending) || Boolean(activeGeneration);
  const title =
    detail?.id === selected
      ? detail.title
      : (conversations.find((item) => item.id === selected)?.title ??
        "New conversation");
  const historyLoading =
    !pendingHere &&
    (initialLoading ||
      Boolean(
        selected && detail?.id !== selected && detailLoadingId === selected,
      ));
  const sidebar = (
    <ConversationSidebar
      conversations={conversations}
      selected={selected}
      onSelect={selectConversation}
      onNew={() => selectConversation(null)}
      onRename={rename}
      onDelete={remove}
      loading={initialLoading}
    />
  );

  return (
    <section
      className="flex min-h-0 min-w-0 flex-1 overflow-hidden border-y border-border/75 bg-background/35 lg:border-x"
      aria-label="AI Coach workspace"
    >
      <aside className="hidden w-[18rem] shrink-0 border-r border-border/70 bg-background-alt/30 lg:block xl:w-76">
        {sidebar}
      </aside>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <header className="flex min-h-17 shrink-0 items-center gap-3 border-b border-border/70 px-4 sm:px-7 lg:px-10">
          <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
            <SheetTrigger
              render={
                <Button
                  variant="ghost"
                  size="icon"
                  className="lg:hidden"
                  aria-label="Open conversations"
                />
              }
            >
              <Menu />
            </SheetTrigger>
            <SheetContent side="left" className="p-0">
              <SheetHeader className="sr-only">
                <SheetTitle>Conversations</SheetTitle>
              </SheetHeader>
              {sidebar}
            </SheetContent>
          </Sheet>
          <div className="min-w-0">
            <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">
              Open Ascent Coach
            </p>
            {historyLoading ? (
              <Skeleton
                className="mt-1 h-4 w-40 max-w-full"
                aria-label="Loading conversation title"
              />
            ) : (
              <h2
                className="truncate text-sm font-medium text-foreground"
                title={title}
              >
                {title}
              </h2>
            )}
          </div>
          <span className="ml-auto hidden shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-foreground-faint sm:block">
            Technique · Skills · Training
          </span>
        </header>
        {historyLoading ? (
          <CoachHistoryLoading />
        ) : messages.length ? (
          <MessageList
            messages={messages}
            onRetry={
              pending?.phase === "failed"
                ? () => void submit(pending.content, pending)
                : undefined
            }
          />
        ) : (
          <div className="coach-scroll flex min-h-0 flex-1 flex-col items-center justify-center gap-7 overflow-y-auto px-5 py-10 text-center">
            <ThemedAsset asset={assets.emptyStates.noCoachConversations} alt="" width={160} />
            <div className="max-w-lg">
              <p className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">
                Train with intention
              </p>
              <h2 className="mt-3 text-3xl font-medium tracking-[-0.045em] text-foreground sm:text-4xl">
                Ask your Open Ascent Coach
              </h2>
              <p className="mt-3 text-sm leading-6 text-foreground-soft">
                Practical answers for calisthenics technique, skills, and
                programming, grounded in your training when relevant.
              </p>
            </div>
            <div className="grid w-full max-w-xl gap-2 sm:grid-cols-2">
              {suggestions.map((item) => (
                <Button
                  key={item}
                  variant="outline"
                  className="h-auto min-h-11 justify-start whitespace-normal border-border/80 bg-transparent px-4 py-2 text-left text-xs leading-5"
                  onClick={() => void submit(item)}
                >
                  {item}
                </Button>
              ))}
            </div>
          </div>
        )}
        <CoachComposer
          draft={draft}
          onDraftChange={setDraft}
          onSend={() => void submit()}
          onGeneratePlan={() => void submit(draft, undefined, "plan")}
          sendBlocked={sendBlocked}
          error={error}
        />
      </div>
    </section>
  );
}
