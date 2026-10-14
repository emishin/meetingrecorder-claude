// MeetingRecorder MCP server: lets Claude Desktop / Claude Code find and read
// the user's meetings straight from the recordings folder on this Mac.
// Read-only, stdio, no dependencies, no network.

import { resolve, scan, search, summaryOf, transcriptOf } from "./library.js";

const VERSION = "0.1.0";
const PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS = `Meetings recorded and transcribed by MeetingRecorder on this Mac.
Use list_meetings for "what meetings did I have" and date ranges, search_meetings to find meetings about a topic, person or project, then get_summary (short) or get_transcript (full text, paged) with the meeting id.
Transcripts are "[mm:ss] Speaker A: text" lines; speakers are labelled A, B, C — their names are not known, infer them from the conversation when it matters.
Search matches word beginnings, so a stem finds all word forms (e.g. "Дим" finds "Диме", "Димой"). Names may be written in Cyrillic or Latin in transcripts — try both spellings when a search finds little.`;

// --- formatting --------------------------------------------------------------

const pad = (n) => String(n).padStart(2, "0");

export function fmtDate(d) {
  if (!d) return "unknown date";
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function fmtDuration(sec) {
  if (sec == null || !Number.isFinite(sec)) return "duration unknown";
  const min = Math.round(sec / 60);
  if (min < 1) return "<1 min";
  return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${pad(min % 60)} min`;
}

function header(m) {
  const has = [m.files.transcript && "transcript", m.files.summary && "summary"].filter(Boolean);
  return `${m.title}\n  id: ${m.id}\n  ${fmtDate(m.date)} · ${fmtDuration(m.duration)} · ${has.length ? has.join(" + ") : "not transcribed"}`;
}

/** "YYYY-MM-DD" → local Date at the start (or end) of that day. */
export function parseDay(s, endOfDay = false) {
  if (s == null || s === "") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim());
  if (!m) throw new Error(`Dates are YYYY-MM-DD, got "${s}".`);
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (d.getMonth() !== Number(m[2]) - 1 || d.getDate() !== Number(m[3])) throw new Error(`No such date: "${s}".`);
  if (endOfDay) d.setHours(23, 59, 59, 999);
  return d;
}

function inRange(meetings, from, to) {
  const a = parseDay(from);
  const b = parseDay(to, true);
  return meetings.filter((m) => (!a || (m.date && m.date >= a)) && (!b || (m.date && m.date <= b)));
}

const clamp = (v, lo, hi, dflt) => {
  const n = Number.isFinite(Number(v)) && v !== null && v !== "" ? Math.floor(Number(v)) : dflt;
  return Math.max(lo, Math.min(hi, n));
};

// --- tools -------------------------------------------------------------------

const dateProps = {
  from: { type: "string", description: "Only meetings on or after this day, YYYY-MM-DD." },
  to: { type: "string", description: "Only meetings on or before this day, YYYY-MM-DD." },
};
const readOnly = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };

export const TOOLS = [
  {
    name: "list_meetings",
    title: "List meetings",
    description: "List recorded meetings, newest first: title, id, date, duration and a one-line gist when available. Filter by date range.",
    inputSchema: {
      type: "object",
      properties: {
        ...dateProps,
        limit: { type: "integer", description: "How many to return (default 50, max 200)." },
        offset: { type: "integer", description: "Skip this many (for paging)." },
      },
    },
    annotations: { ...readOnly, title: "List meetings" },
  },
  {
    name: "search_meetings",
    title: "Search meetings",
    description: 'Find meetings whose title, summary or transcript contains all the words of the query (case-insensitive; put a phrase in "quotes" to match it exactly). Returns the best matches with snippets.',
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to look for, e.g. a person, company, project or topic." },
        ...dateProps,
        limit: { type: "integer", description: "How many meetings to return (default 10, max 30)." },
      },
      required: ["query"],
    },
    annotations: { ...readOnly, title: "Search meetings" },
  },
  {
    name: "get_transcript",
    title: "Get transcript",
    description: "Full transcript of one meeting by id. Long transcripts come in parts: call again with the returned next offset to read on.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Meeting id from list_meetings or search_meetings." },
        offset: { type: "integer", description: "Character offset to start from (default 0)." },
        max_chars: { type: "integer", description: "Characters per part (default 40000, max 100000)." },
      },
      required: ["id"],
    },
    annotations: { ...readOnly, title: "Get transcript" },
  },
  {
    name: "get_summary",
    title: "Get summary",
    description: "The short gist and the full summary of one meeting by id, if MeetingRecorder has made them.",
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "Meeting id from list_meetings or search_meetings." } },
      required: ["id"],
    },
    annotations: { ...readOnly, title: "Get summary" },
  },
];

export const handlers = {
  async list_meetings(args) {
    const all = inRange(await scan(), args.from, args.to);
    const offset = clamp(args.offset, 0, Number.MAX_SAFE_INTEGER, 0);
    const limit = clamp(args.limit, 1, 200, 50);
    const page = all.slice(offset, offset + limit);
    if (!page.length) return all.length ? `No meetings past offset ${offset} (total ${all.length}).` : "No meetings in this range.";
    const lines = page.map((m) => header(m) + (m.gist ? `\n  ${m.gist}` : ""));
    const more = offset + page.length < all.length ? `\n\nMore: call again with offset ${offset + page.length}.` : "";
    return `${all.length} meeting(s); showing ${offset + 1}–${offset + page.length}.\n\n${lines.join("\n\n")}${more}`;
  },

  async search_meetings(args) {
    if (!String(args.query || "").trim()) throw new Error("query is empty.");
    const pool = inRange(await scan(), args.from, args.to);
    const hits = await search(pool, args.query, clamp(args.limit, 1, 30, 10));
    if (!hits.length) return `Nothing found for "${args.query}" in ${pool.length} meeting(s).`;
    const blocks = hits.map(({ meeting, matchedIn, snippets }) =>
      [header(meeting), meeting.gist && `  ${meeting.gist}`, `  found in: ${matchedIn.join(", ")}`, ...snippets.map((s) => `  > ${s}`)]
        .filter(Boolean)
        .join("\n"),
    );
    return `${hits.length} meeting(s) for "${args.query}":\n\n${blocks.join("\n\n")}`;
  },

  async get_transcript(args) {
    const m = resolve(await scan(), args.id);
    const text = await transcriptOf(m);
    if (text == null) return `${header(m)}\n\nThis meeting has no transcript yet. It can be transcribed in the MeetingRecorder app.`;
    const total = text.length;
    const offset = clamp(args.offset, 0, total, 0);
    const max = clamp(args.max_chars, 1000, 100000, 40000);
    let end = Math.min(total, offset + max);
    if (end < total) {
      const nl = text.lastIndexOf("\n", end);
      if (nl > offset) end = nl + 1; // cut between lines
    }
    const part =
      offset === 0 && end === total
        ? `full transcript, ${total} characters`
        : `characters ${offset}–${end} of ${total}` + (end < total ? `; next part: offset ${end}` : "; last part");
    return `${header(m)}\n  (${part})\n\n${text.slice(offset, end)}`;
  },

  async get_summary(args) {
    const m = resolve(await scan(), args.id);
    const summary = await summaryOf(m);
    const gist = m.gist ? `Gist: ${m.gist}` : null;
    const body = summary?.trim() || "No summary yet. It can be created in the MeetingRecorder app.";
    return [header(m), gist, body].filter(Boolean).join("\n\n");
  },
};

// --- JSON-RPC over stdio -------------------------------------------------------

// Swappable in tests (the test runner reports on stdout too).
export const io = { write: (line) => process.stdout.write(line) };

export function send(msg) {
  io.write(`${JSON.stringify({ jsonrpc: "2.0", ...msg })}\n`);
}

export async function handle(req) {
  const { id, method, params } = req;
  const reply = (result) => id !== undefined && send({ id, result });
  const fail = (code, message) => id !== undefined && send({ id, error: { code, message } });

  switch (method) {
    case "initialize": {
      const asked = params?.protocolVersion;
      return reply({
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[1],
        capabilities: { tools: {} },
        serverInfo: { name: "meetingrecorder", title: "MeetingRecorder", version: VERSION },
        instructions: INSTRUCTIONS,
      });
    }
    case "ping":
      return reply({});
    case "tools/list":
      return reply({ tools: TOOLS });
    case "tools/call": {
      const handler = handlers[params?.name];
      if (!handler) return fail(-32602, `Unknown tool: ${params?.name}`);
      try {
        const text = await handler(params.arguments || {});
        return reply({ content: [{ type: "text", text }] });
      } catch (e) {
        return reply({ content: [{ type: "text", text: e.message }], isError: true });
      }
    }
    default:
      if (method?.startsWith("notifications/")) return undefined;
      return fail(-32601, `Method not found: ${method}`);
  }
}
