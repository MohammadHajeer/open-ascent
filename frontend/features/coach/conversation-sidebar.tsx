"use client";

import { useState } from "react";
import { Check, MoreHorizontal, Pencil, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { Conversation } from "./types";

export function shortConversationTitle(title: string): string {
  const clean = title.replace(/\s+/g, " ").trim();
  return clean.length > 48 ? `${clean.slice(0, 47).trimEnd()}…` : clean;
}

export function ConversationSidebar({
  conversations,
  selected,
  onSelect,
  onNew,
  onRename,
  loading = false,
}: {
  conversations: Conversation[];
  selected: string | null;
  onSelect: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => Promise<void>;
  loading?: boolean;
}) {
  const [editing, setEditing] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);

  async function saveTitle() {
    if (!editing || !title.trim()) return;
    try {
      await onRename(editing, title.trim());
      setEditing(null);
      setRenameError(null);
    } catch (error) {
      setRenameError(error instanceof Error ? error.message : "Could not rename conversation.");
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col px-4 py-5 lg:px-5">
      <div className="border-b border-border/70 pb-5">
        <p className="mb-3 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-primary">Your workspace</p>
        <Button variant="outline" className="h-10 w-full justify-start gap-2 border-primary/30 bg-primary-light/40 px-3 text-foreground hover:bg-primary-light" onClick={onNew}>
          <Plus className="size-4 text-primary" /> New chat
        </Button>
      </div>
      <p className="px-2 pb-2 pt-6 font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-foreground-faint">Conversations</p>
      <nav className="coach-scroll min-h-0 flex-1 space-y-1 overflow-y-auto pr-1" aria-label="Coach conversations">
        {loading && <div className="space-y-3 px-2 py-2" role="status" aria-label="Loading conversations"><Skeleton className="h-9 w-full" /><Skeleton className="h-9 w-4/5" /><Skeleton className="h-9 w-3/5" /></div>}
        {conversations.map(item => editing === item.id ? (
          <div key={item.id} className="space-y-1 rounded-md bg-primary-light/50 p-2">
            <div className="flex gap-1">
              <Input aria-label="Conversation title" autoFocus maxLength={80} value={title} onChange={event => setTitle(event.target.value)} onKeyDown={event => { if (event.key === "Enter") void saveTitle(); if (event.key === "Escape") setEditing(null); }} className="h-8 min-w-0 px-2 text-xs" />
              <Button size="icon-xs" aria-label="Save title" onClick={() => void saveTitle()} disabled={!title.trim()}><Check className="size-3" /></Button>
              <Button size="icon-xs" variant="ghost" aria-label="Cancel rename" onClick={() => setEditing(null)}><X className="size-3" /></Button>
            </div>
            {renameError && <p role="alert" className="text-xs text-destructive">{renameError}</p>}
          </div>
        ) : (
          <div key={item.id} className={`group relative flex min-w-0 items-center rounded-md ${selected === item.id ? "bg-primary-light" : "hover:bg-muted/60"}`}>
            {selected === item.id && <span className="absolute inset-y-2 left-0 w-0.5 rounded-full bg-primary" aria-hidden="true" />}
            <Button
              variant="ghost"
              aria-current={selected === item.id ? "page" : undefined}
              title={item.title}
              className={`h-11 min-w-0 flex-1 justify-start rounded-md px-3 text-left text-sm font-normal hover:bg-transparent ${selected === item.id ? "text-foreground" : "text-foreground-soft hover:text-foreground"}`}
              onClick={() => onSelect(item.id)}
            >
              <span className="block min-w-0 truncate">{shortConversationTitle(item.title)}</span>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="ghost" size="icon-xs" aria-label={`Options for ${item.title}`} className="mr-1 text-foreground-faint opacity-100 md:opacity-0 md:focus:opacity-100 md:group-hover:opacity-100 data-popup-open:opacity-100" />}><MoreHorizontal className="size-3.5" /></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-36">
                <DropdownMenuItem onClick={() => { setTitle(item.title); setEditing(item.id); setRenameError(null); }}><Pencil className="size-3.5" />Rename</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ))}
        {!loading && !conversations.length && <p className="px-2 py-4 text-sm leading-6 text-foreground-faint">Start a conversation to keep your coaching notes together.</p>}
      </nav>
    </div>
  );
}
