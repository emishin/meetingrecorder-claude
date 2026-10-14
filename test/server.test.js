import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import { dateFromName, has, lastTimestamp, parseMvhd, resolve, scan, snippets, terms, titleFromName } from "../server/library.js";
import { fmtDuration, handle, handlers, io, parseDay } from "../server/index.js";

// A minimal MP4: ftyp + moov(mvhd v0, timescale 1000, duration 754000 = 12:34).
function mp4(seconds) {
  const box = (type, body) => {
    const b = Buffer.alloc(8 + body.length);
    b.writeUInt32BE(b.length, 0);
    b.write(type, 4, "latin1");
    body.copy(b, 8);
    return b;
  };
  const mvhd = Buffer.alloc(100);
  mvhd.writeUInt32BE(1000, 12); // timescale (after version/flags + 2 dates)
  mvhd.writeUInt32BE(seconds * 1000, 16);
  return Buffer.concat([box("ftyp", Buffer.from("M4A \0\0\0\0", "latin1")), box("moov", box("mvhd", mvhd))]);
}

const dir = mkdtempSync(path.join(os.tmpdir(), "mr-mcp-"));
process.env.MR_RECORDINGS_DIR = dir;
const A = "2026-10-14_12-08-55_Бюджет-проекта-и-планы-Acme";
const B = "2026-10-01_09-00-00";
writeFileSync(path.join(dir, `${A}.m4a`), mp4(754));
writeFileSync(path.join(dir, `${A}_mic.m4a`), mp4(754));
writeFileSync(path.join(dir, `${A}.txt`), "[00:01] Speaker A: Привет, Дима.\n\n[12:30] Speaker B: Обсудим сделку и оффер.\n");
writeFileSync(path.join(dir, `${A}.summary.txt`), "# Бюджет проекта\n\n## Summary\nОффер обсудят позже.\n");
execFileSync("/usr/bin/xattr", ["-w", "com.meetingrecorder.title", "Бюджет проекта и планы Acme", `${A}.m4a`], { cwd: dir });
execFileSync("/usr/bin/xattr", ["-w", "com.meetingrecorder.gist", "Дима предложил бюджет.", `${A}.m4a`], { cwd: dir });
writeFileSync(path.join(dir, `${B}.txt`), "[00:05] Speaker A: Погода.\n[1:02:03] Speaker B: Пока.\n"); // audio deleted
writeFileSync(path.join(dir, "notes.docx"), "x");

test("file-name helpers", () => {
  assert.equal(titleFromName("2026-10-14_12-08-55_Бюджет-проекта"), "Бюджет проекта");
  assert.equal(titleFromName("2026-10-14_12-08-55"), null);
  assert.equal(titleFromName("New Recording 2"), "New Recording 2");
  assert.deepEqual(dateFromName(B), new Date(2026, 9, 1, 9, 0, 0));
  assert.equal(dateFromName("Muminov Street"), null);
  assert.equal(lastTimestamp("[00:05] a\n[1:02:03] b"), 3723);
});

test("mvhd duration", () => {
  assert.equal(parseMvhd(mp4(754).subarray(24)), 754);
});

test("search terms match word beginnings, ё = е", () => {
  assert.deepEqual(terms('Дим "новый оффер"'), ["новый оффер", "дим"]);
  assert.ok(has("привет, дима", "дим"));
  assert.ok(!has("обсудим сделку", "дим"));
  assert.ok(!has("сделка", "елка"));
  assert.ok(has("c++ и (x)", "c++"));
});

test("snippets keep the speaker stamp when clipped", () => {
  const line = `[00:10] Speaker A: ${"слово ".repeat(100)}Acme ${"ещё ".repeat(100)}`;
  const [s] = snippets(line, ["acme"], 1, 80);
  assert.match(s, /^\[00:10\] Speaker A: …/);
  assert.match(s, /Acme/);
});

test("scan: one meeting per base, sub-tracks folded, other files ignored", async () => {
  const ms = await scan();
  assert.deepEqual(ms.map((m) => m.id), [A, B]);
  const [a, b] = ms;
  assert.equal(a.title, "Бюджет проекта и планы Acme");
  assert.equal(a.gist, "Дима предложил бюджет.");
  assert.equal(a.duration, 754);
  assert.equal(b.title, "Untitled recording");
  assert.equal(b.duration, 3723); // from the transcript, no audio
  assert.equal(resolve(ms, "2026-10-14").id, A);
  assert.throws(() => resolve(ms, "2026"), /matches 2 meetings/);
  assert.throws(() => resolve(ms, "nope"), /No meeting/);
});

test("tools", async () => {
  const list = await handlers.list_meetings({ from: "2026-10-10" });
  assert.match(list, /^1 meeting/);
  assert.match(list, /13 min/);
  assert.match(await handlers.search_meetings({ query: "оффер дим" }), /Speaker B: Обсудим сделку и оффер/);
  assert.match(await handlers.search_meetings({ query: "погода", to: "2026-09-30" }), /Nothing found/);
  const part = await handlers.get_transcript({ id: A, max_chars: 1000 });
  assert.match(part, /full transcript/);
  assert.match(await handlers.get_summary({ id: A }), /Gist: Дима предложил бюджет\.[\s\S]*## Summary/);
  assert.match(await handlers.get_summary({ id: B }), /No summary yet/);
  assert.throws(() => parseDay("2026-02-30"), /No such date/);
  assert.equal(fmtDuration(3723), "1 h 02 min");
});

test("get_transcript pages end on line breaks and chain by offset", async () => {
  const long = Array.from({ length: 400 }, (_, i) => `[00:${String(i % 60).padStart(2, "0")}] Speaker A: строка ${i}`).join("\n");
  writeFileSync(path.join(dir, "2026-09-01_10-00-00.txt"), long);
  let offset = 0;
  let text = "";
  for (let i = 0; i < 20; i++) {
    const out = await handlers.get_transcript({ id: "2026-09-01_10-00-00", offset, max_chars: 1000 });
    const body = out.slice(out.indexOf("\n\n") + 2);
    text += body;
    const next = /next part: offset (\d+)/.exec(out);
    if (!next) break;
    assert.ok(body.endsWith("\n"));
    offset = Number(next[1]);
  }
  assert.equal(text, long);
});

test("JSON-RPC: initialize, tools/list, errors", async () => {
  const out = [];
  const write = io.write;
  io.write = (s) => out.push(JSON.parse(s));
  try {
    await handle({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } });
    await handle({ jsonrpc: "2.0", method: "notifications/initialized" });
    await handle({ jsonrpc: "2.0", id: 2, method: "tools/list" });
    await handle({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "get_summary", arguments: { id: "zzz" } } });
    await handle({ jsonrpc: "2.0", id: 4, method: "nope" });
  } finally {
    io.write = write;
  }
  assert.equal(out.length, 4); // no reply to the notification
  assert.equal(out[0].result.protocolVersion, "2025-06-18");
  assert.deepEqual(out[1].result.tools.map((t) => t.name), ["list_meetings", "search_meetings", "get_transcript", "get_summary"]);
  assert.equal(out[2].result.isError, true);
  assert.equal(out[3].error.code, -32601);
});
