import { authApiFetch, authApiRequest } from "@/lib/auth-api";
import { SseParser } from "@/lib/sse-parser";
import type { Conversation, ConversationDetail, Generation } from "./types";

export const listConversations = () => authApiFetch<Conversation[]>("/coach/conversations", { cache: "no-store" });
export const createConversation = () => authApiFetch<Conversation>("/coach/conversations", { method: "POST" });
export const getConversation = (id: string) => authApiFetch<ConversationDetail>(`/coach/conversations/${id}`, { cache: "no-store" });
export const sendFirstMessage = (content: string, clientRequestId: string) => authApiFetch<{ conversation: Conversation; generation_id: string; created: boolean }>("/coach/conversations/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content, client_request_id: clientRequestId }) });
export const sendMessage = (id: string, content: string, clientRequestId: string) => authApiFetch<{ generation_id: string; created: boolean }>(`/coach/conversations/${id}/messages`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content, client_request_id: clientRequestId }) });
export const renameConversation = (id: string, title: string) => authApiFetch<Conversation>(`/coach/conversations/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title }) });

export async function streamGeneration(conversationId: string, generationId: string, onSnapshot: (value: Generation) => void, signal: AbortSignal) {
  const response = await authApiRequest(`/coach/conversations/${conversationId}/generations/${generationId}/events`, { signal, cache: "no-store" });
  if (!response.ok || !response.body) throw new Error("Could not reconnect to the coach response.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parser = new SseParser();
  let terminal = false;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) {
        if (!terminal && !signal.aborted) throw new Error("Stream disconnected. Reload to inspect the saved response.");
        return;
      }
      for (const event of parser.push(decoder.decode(value, { stream: true }))) {
        if (event.event === "snapshot") {
          const snapshot = JSON.parse(event.data) as Generation;
          if (["completed", "failed", "interrupted"].includes(snapshot.status)) terminal = true;
          onSnapshot(snapshot);
        }
      }
    }
  } finally { reader.releaseLock(); }
}
