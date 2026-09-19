export type SseMessage = { id: string | null; event: string; data: string };

export class SseParser {
  private buffer = "";
  private lines: string[] = [];

  push(chunk: string): SseMessage[] {
    this.buffer += chunk;
    const messages: SseMessage[] = [];
    let newline = this.buffer.indexOf("\n");
    while (newline !== -1) {
      const line = this.buffer.slice(0, newline).replace(/\r$/, "");
      this.buffer = this.buffer.slice(newline + 1);
      if (line === "") {
        const message = this.message();
        if (message) messages.push(message);
        this.lines = [];
      } else if (!line.startsWith(":")) {
        this.lines.push(line);
      }
      newline = this.buffer.indexOf("\n");
    }
    return messages;
  }

  private message(): SseMessage | null {
    let id: string | null = null;
    let event = "message";
    const data: string[] = [];
    for (const line of this.lines) {
      const separator = line.indexOf(":");
      const field = separator < 0 ? line : line.slice(0, separator);
      const raw = separator < 0 ? "" : line.slice(separator + 1);
      const value = raw.startsWith(" ") ? raw.slice(1) : raw;
      if (field === "id") id = value;
      else if (field === "event") event = value;
      else if (field === "data") data.push(value);
    }
    return data.length ? { id, event, data: data.join("\n") } : null;
  }
}
