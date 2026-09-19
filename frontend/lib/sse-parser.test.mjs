import assert from "node:assert/strict";
import test from "node:test";

import { SseParser } from "./sse-parser.ts";

test("SSE parser preserves ordered IDs and complete payloads across chunks", () => {
  const parser = new SseParser();
  assert.deepEqual(parser.push(": ping\r\nid: 10\r\nevent: rep_com"), []);
  assert.deepEqual(parser.push("pleted\r\ndata: {\"rep_index\":1,\"outcome\":\"valid\"}\r\n\r\n"), [
    { id: "10", event: "rep_completed", data: '{"rep_index":1,"outcome":"valid"}' },
  ]);
  assert.deepEqual(parser.push("event: state\r\ndata: {\"status\":\"running\"}\r\n\r\n"), [
    { id: null, event: "state", data: '{"status":"running"}' },
  ]);
});
