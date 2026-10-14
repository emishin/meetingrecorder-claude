// Reads MeetingRecorder's recordings folder. The app has no database: every
// meeting is a set of files with one base name —
//   <base>.m4a           audio (+ <base>_mic.m4a / <base>_system.m4a tracks)
//   <base>.txt           transcript, "[mm:ss] Speaker A: …" lines
//   <base>.summary.txt   summary (markdown)
// plus two extended attributes on <base>.m4a that the app writes since 1.6.8:
// com.meetingrecorder.title and com.meetingrecorder.gist.
// Nothing here writes to the folder.

import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

const STAMP = /^(\d{4})-(\d{2})-(\d{2})_(\d{2})-(\d{2})-(\d{2})/;
const TITLE_KEY = "com.meetingrecorder.title";
const GIST_KEY = "com.meetingrecorder.gist";
const PREFS = path.join(os.homedir(), "Library/Preferences/com.meetingrecorder.app.plist");

/** The folder the app records into (Settings → Recordings folder). */
export async function recordingsDir() {
  if (process.env.MR_RECORDINGS_DIR) return process.env.MR_RECORDINGS_DIR;
  try {
    const { stdout } = await run("/usr/bin/defaults", ["read", PREFS, "recordingsDirectory"]);
    const dir = stdout.trim();
    if (dir) return dir;
  } catch {
    // never changed in Settings → the default below
  }
  return path.join(os.homedir(), "Documents/MeetingRecordings");
}

export function isSubTrack(base) {
  return base.endsWith("_mic") || base.endsWith("_system");
}

/** Recording time from the "yyyy-MM-dd_HH-mm-ss" prefix (local time). */
export function dateFromName(base) {
  const m = STAMP.exec(base);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m.map(Number);
  return new Date(y, mo - 1, d, h, mi, s);
}

/** Same rule as RecordingStorage.title(fromFileName:) in the app. */
export function titleFromName(base) {
  let title = base.replace(/^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_?/, "");
  if (!title.includes(" ")) title = title.replaceAll("-", " ");
  title = title.trim();
  return title || null;
}

/** "# Heading" at the top of a summary file. */
export function titleFromSummary(summary) {
  const m = /^#\s+(.+)$/m.exec(summary || "");
  return m ? m[1].trim() : null;
}

/** Seconds of the last "[h:mm:ss]" / "[mm:ss]" stamp in a transcript. */
export function lastTimestamp(transcript) {
  const all = [...(transcript || "").matchAll(/^\[(?:(\d+):)?(\d{1,2}):(\d{2})\]/gm)];
  if (!all.length) return null;
  const [, h, m, s] = all[all.length - 1];
  return Number(h || 0) * 3600 + Number(m) * 60 + Number(s);
}

/** Duration from the MP4 movie header (moov/mvhd) — no audio decoding. */
export async function m4aDuration(file) {
  let fh;
  try {
    fh = await fs.open(file, "r");
    const { size: fileSize } = await fh.stat();
    let pos = 0;
    const head = Buffer.alloc(16);
    while (pos + 8 <= fileSize) {
      await fh.read(head, 0, 16, pos);
      let size = head.readUInt32BE(0);
      const type = head.toString("latin1", 4, 8);
      let headerLen = 8;
      if (size === 1) {
        size = Number(head.readBigUInt64BE(8));
        headerLen = 16;
      } else if (size === 0) {
        size = fileSize - pos;
      }
      if (size < headerLen) return null;
      if (type === "moov") {
        const len = Math.min(size - headerLen, 1 << 20);
        const body = Buffer.alloc(len);
        await fh.read(body, 0, len, pos + headerLen);
        return parseMvhd(body);
      }
      pos += size;
    }
    return null;
  } catch {
    return null;
  } finally {
    await fh?.close();
  }
}

export function parseMvhd(moov) {
  let pos = 0;
  while (pos + 8 <= moov.length) {
    const size = moov.readUInt32BE(pos);
    const type = moov.toString("latin1", pos + 4, pos + 8);
    if (type === "mvhd") {
      const version = moov[pos + 8];
      const base = pos + 12;
      const timescale = version === 1 ? moov.readUInt32BE(base + 16) : moov.readUInt32BE(base + 8);
      const duration = version === 1 ? Number(moov.readBigUInt64BE(base + 20)) : moov.readUInt32BE(base + 12);
      return timescale ? duration / timescale : null;
    }
    if (size < 8) return null;
    pos += size;
  }
  return null;
}

/** One `xattr -p` call for all files; returns Map(file name → value). */
export async function readXattr(dir, names, key) {
  const out = new Map();
  if (!names.length) return out;
  let stdout = "";
  try {
    ({ stdout } = await run("/usr/bin/xattr", ["-p", key, ...names], { cwd: dir, maxBuffer: 64 << 20 }));
  } catch (e) {
    stdout = e.stdout || ""; // exits non-zero when some files lack the key
  }
  if (names.length === 1) {
    // a single file prints the bare value, without the "name: " prefix
    if (stdout.trim()) out.set(names[0], stdout.trim());
    return out;
  }
  const known = new Set(names);
  let current = null;
  for (const line of stdout.split("\n")) {
    const cut = line.indexOf(".m4a: ");
    const name = cut >= 0 ? line.slice(0, cut + 4) : null;
    if (name && known.has(name)) {
      current = name;
      out.set(name, line.slice(cut + 6));
    } else if (current && line) {
      out.set(current, `${out.get(current)}\n${line}`); // multi-line value
    }
  }
  for (const [k, v] of out) out.set(k, v.trim());
  return out;
}

// --- Library -----------------------------------------------------------------

const durationCache = new Map(); // "path|size|mtime" → seconds
const textCache = new Map(); // path → { mtimeMs, text }

async function readText(file) {
  try {
    const st = await fs.stat(file);
    const hit = textCache.get(file);
    if (hit && hit.mtimeMs === st.mtimeMs) return hit.text;
    const text = (await fs.readFile(file, "utf8")).normalize("NFC");
    textCache.set(file, { mtimeMs: st.mtimeMs, text });
    return text;
  } catch {
    return null;
  }
}

/** All meetings in the folder, newest first. Cheap enough to run per call. */
export async function scan(dir) {
  const dir_ = dir || (await recordingsDir());
  let entries;
  try {
    entries = await fs.readdir(dir_);
  } catch (e) {
    throw new Error(`Can't read the recordings folder ${dir_}: ${e.code || e.message}`);
  }
  const files = new Set(entries);
  const bases = new Set();
  for (const name of entries) {
    if (name.startsWith(".")) continue;
    if (name.endsWith(".summary.txt")) continue;
    let base = null;
    if (name.toLowerCase().endsWith(".m4a")) base = name.slice(0, -4);
    else if (name.endsWith(".txt")) base = name.slice(0, -4);
    if (base && !isSubTrack(base)) bases.add(base);
  }

  const audioNames = [...bases].map((b) => `${b}.m4a`).filter((n) => files.has(n));
  const [titles, gists] = await Promise.all([
    readXattr(dir_, audioNames, TITLE_KEY),
    readXattr(dir_, audioNames, GIST_KEY),
  ]);

  const meetings = await Promise.all(
    [...bases].map(async (base) => {
      const audio = files.has(`${base}.m4a`) ? path.join(dir_, `${base}.m4a`) : null;
      const transcript = files.has(`${base}.txt`) ? path.join(dir_, `${base}.txt`) : null;
      const summary = files.has(`${base}.summary.txt`) ? path.join(dir_, `${base}.summary.txt`) : null;
      const main = audio || transcript;
      const st = await fs.stat(main).catch(() => null);

      let duration = null;
      if (audio && st) {
        const key = `${audio}|${st.size}|${st.mtimeMs}`;
        if (!durationCache.has(key)) durationCache.set(key, await m4aDuration(audio));
        duration = durationCache.get(key);
      }
      if (duration == null && transcript) duration = lastTimestamp(await readText(transcript));

      const summaryText = summary ? await readText(summary) : null;
      const id = base.normalize("NFC");
      return {
        id,
        title:
          titles.get(`${base}.m4a`) || titleFromName(id) || titleFromSummary(summaryText) || "Untitled recording",
        date: dateFromName(base) || (st ? st.birthtime : null),
        duration,
        gist: gists.get(`${base}.m4a`) || null,
        files: { audio, transcript, summary },
      };
    }),
  );
  meetings.sort((a, b) => (b.date?.getTime() || 0) - (a.date?.getTime() || 0));
  return meetings;
}

/** Exact id, else a unique prefix (e.g. "2026-10-14_15-02"), else exact title. */
export function resolve(meetings, ref) {
  const want = String(ref || "").normalize("NFC").trim();
  if (!want) throw new Error("Pass the meeting id from list_meetings or search_meetings.");
  const exact = meetings.find((m) => m.id === want);
  if (exact) return exact;
  const prefix = meetings.filter((m) => m.id.startsWith(want));
  if (prefix.length === 1) return prefix[0];
  const byTitle = meetings.filter((m) => m.title.toLowerCase() === want.toLowerCase());
  if (byTitle.length === 1) return byTitle[0];
  const many = prefix.length > 1 ? prefix : byTitle;
  if (many.length > 1) {
    throw new Error(`"${want}" matches ${many.length} meetings: ${many.slice(0, 5).map((m) => m.id).join(", ")}. Use the full id.`);
  }
  throw new Error(`No meeting "${want}". Use list_meetings or search_meetings to get an id.`);
}

export const transcriptOf = (m) => (m.files.transcript ? readText(m.files.transcript) : Promise.resolve(null));
export const summaryOf = (m) => (m.files.summary ? readText(m.files.summary) : Promise.resolve(null));

// --- Search ------------------------------------------------------------------

/** Lowercase, NFC, ё → е, so "Ёлка" finds "елка". */
export function fold(s) {
  return (s || "").normalize("NFC").toLowerCase().replaceAll("ё", "е");
}

export function terms(query) {
  const q = fold(query).trim();
  const phrases = [...q.matchAll(/"([^"]+)"/g)].map((m) => m[1].trim()).filter(Boolean);
  const rest = q.replace(/"[^"]*"/g, " ").split(/\s+/).filter(Boolean);
  return [...phrases, ...rest];
}

// A term matches at the start of a word, so "Дим" finds "Диме" and "Димой"
// but "елка" doesn't find "сделка".
const esc = (t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const wordRe = (t, flags = "u") => new RegExp(`(?<![\\p{L}\\p{N}])${esc(t)}`, flags);
export const has = (hay, t) => wordRe(t).test(hay);
const count = (hay, t) => (hay.match(wordRe(t, "gu")) || []).length;

/** Lines that contain the terms (most terms first), clipped around the hit. */
export function snippets(text, ts, max = 3, width = 280) {
  const lines = (text || "").split("\n");
  const scored = [];
  lines.forEach((line, i) => {
    const f = fold(line);
    const hits = ts.filter((t) => has(f, t)).length;
    if (hits) scored.push({ i, hits, line });
  });
  scored.sort((a, b) => b.hits - a.hits || a.i - b.i);
  return scored
    .slice(0, max)
    .sort((a, b) => a.i - b.i)
    .map(({ line }) => {
      const t = line.trim();
      if (t.length <= width) return t;
      const f = fold(t);
      const at = Math.max(0, Math.min(...ts.map((x) => f.search(wordRe(x))).filter((x) => x >= 0)) - width / 3);
      const stamp = /^\[[\d:]+\]\s*[^:]{0,40}:/.exec(t)?.[0];
      const body = t.slice(at, at + width);
      return `${stamp && at > 0 ? `${stamp} ` : ""}${at > 0 ? "…" : ""}${body}${at + width < t.length ? "…" : ""}`;
    });
}

/** Meetings where every term occurs in the title, gist, summary or transcript. */
export async function search(meetings, query, limit = 10) {
  const ts = terms(query);
  if (!ts.length) return [];
  const results = [];
  for (const m of meetings) {
    const [transcript, summary] = await Promise.all([transcriptOf(m), summaryOf(m)]);
    const parts = {
      title: fold(m.title),
      gist: fold(m.gist),
      summary: fold(summary),
      transcript: fold(transcript),
    };
    const all = Object.values(parts).join("\n");
    if (!ts.every((t) => has(all, t))) continue;
    let score = 0;
    const where = [];
    for (const [k, v] of Object.entries(parts)) {
      const n = ts.reduce((acc, t) => acc + count(v, t), 0);
      if (n) where.push(k);
      score += n * { title: 20, gist: 8, summary: 3, transcript: 1 }[k];
    }
    results.push({
      meeting: m,
      score,
      matchedIn: where,
      snippets: [...snippets(summary, ts, 1), ...snippets(transcript, ts, 3)],
    });
  }
  results.sort((a, b) => b.score - a.score);
  return results.slice(0, limit);
}
