export type Conversation = { id: string; title: string; created_at: string; updated_at: string };
export type CoachMessage = { id: string; role: "user" | "assistant"; content: string; status: "streaming" | "completed" | "failed" | "interrupted"; created_at: string; generation_id: string | null };
export type ConversationDetail = Conversation & { messages: CoachMessage[] };
export type Generation = { id: string; status: CoachMessage["status"] | "reserved" | "requesting"; content: string; error_code: string | null };
