#!/usr/bin/env node
// Entry point: newline-delimited JSON-RPC on stdin/stdout (MCP stdio).
import readline from "node:readline";
import { handle, send } from "./index.js";

const pending = new Set();
const rl = readline.createInterface({ input: process.stdin });
rl.on("line", (line) => {
  if (!line.trim()) return;
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    send({ id: null, error: { code: -32700, message: "Parse error" } });
    return;
  }
  const p = handle(req)
    .catch((e) => console.error("[meetingrecorder-mcp]", e))
    .finally(() => pending.delete(p));
  pending.add(p);
});
rl.on("close", async () => {
  await Promise.all(pending);
  process.exit(0);
});
