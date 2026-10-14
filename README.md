# MeetingRecorder for Claude

Let Claude find and read the meetings you record with [MeetingRecorder](https://meetingsrecorder.com), the meeting recorder for Mac. Ask things like:

- "What did we decide with Anna about the Acme pricing last week?"
- "List my meetings from Monday and give me the action items."
- "Pull everything we discussed about the mobile app launch into a project brief."

Claude finds the right meetings, reads their summaries, and goes into the full transcript when it needs exact details or quotes.

## What's inside

- **MCP server** (`server/`) with four read-only tools:
  - `list_meetings` — meetings by date: title, date, duration and a one-line gist;
  - `search_meetings` — meetings whose title, summary or transcript contain the words you ask for, with snippets;
  - `get_transcript` — the full transcript of a meeting, in parts for long meetings;
  - `get_summary` — the short gist and the full summary of a meeting.
- **Skill** (`skills/meetings`) that tells Claude how to use them: find the meeting, read the summary first, cite meeting titles and dates.

## Requirements

- macOS with [MeetingRecorder](https://meetingsrecorder.com) and at least one transcribed meeting.
- [Node.js](https://nodejs.org) 18 or later (the server is plain JavaScript with no dependencies).
- Works in **Claude Code** and in **Cowork** sessions that run on your Mac. For the regular chat in the Claude desktop app, install the MeetingRecorder desktop extension (`.mcpb`) instead — chat doesn't start local servers from plugins.

## Install

From the plugin directory in Claude (**Customize → Plugins**), or in Claude Code:

```bash
claude plugin marketplace add emishin/meetingrecorder-claude
claude plugin install meetingrecorder@meetingrecorder
```

The first time Claude reads your meetings, macOS may ask whether to allow access to the Documents folder (where MeetingRecorder keeps recordings by default). Allow it.

## How it works

MeetingRecorder keeps every meeting as files in its recordings folder (`~/Documents/MeetingRecordings` unless you changed it in the app's Settings):

| File | What it is |
|---|---|
| `<name>.m4a` | the audio; the meeting's title and one-line gist are stored as extended attributes of this file |
| `<name>.txt` | the transcript, `[mm:ss] Speaker A: …` lines |
| `<name>.summary.txt` | the summary (Markdown) |

The server reads these files and nothing else. To do it, it runs two macOS system commands: `/usr/bin/defaults` to read which folder the app records into, and `/usr/bin/xattr` to read the title and gist. It never reads the audio itself, beyond the file header that holds the duration.

Set `MR_RECORDINGS_DIR` to point the server at another folder.

## Privacy Policy

- **Data it reads:** only the files in your MeetingRecorder recordings folder on your Mac — transcripts, summaries, meeting titles and gists, file names and durations — and only when Claude calls one of the tools.
- **Where the data goes:** the result of each tool call goes to the Claude conversation you are having, and nowhere else. The plugin makes no network requests and has no analytics or telemetry. MeetingRecorder's servers receive nothing from it.
- **Storage and retention:** the plugin stores nothing. It keeps file contents in memory only while it runs, and never writes, moves, renames or deletes your files.
- **Third parties:** none. What happens to your conversations in Claude is governed by your agreement with Anthropic.
- **Contact:** hello@meetingsrecorder.com.

Full policy: https://meetingsrecorder.com/privacy/

## Development

```bash
npm test                                                          # unit tests (node:test)
claude --plugin-dir .                                             # try the plugin in Claude Code
npx -y @anthropic-ai/mcpb@2.1.2 pack . dist/meetingrecorder.mcpb  # desktop extension for Claude chat
```

## License

MIT
