---
name: meetings
description: Use when the user asks about their meetings or calls recorded with MeetingRecorder — what was discussed or decided, action items and owners, what someone said, a meeting's summary, preparing for a follow-up, or bringing meeting notes into a project or document.
---

The MeetingRecorder tools read the user's recorded meetings on this Mac.

1. Find the meeting first:
   - a topic, person, company or project → `search_meetings` (all words must match; a word stem finds every form of the word, so search "Dmitr" for "Dmitry/Dmitriy");
   - a day or period ("yesterday", "last week") → `list_meetings` with `from`/`to` as YYYY-MM-DD;
   - if a search finds little, try other spellings (names can be in Cyrillic or Latin) and fewer words.
2. Read the summary before the transcript: `get_summary` is short and usually enough for "what was decided" and "what are the next steps".
3. Use `get_transcript` for exact quotes, details the summary leaves out, or when there is no summary. Long transcripts come in parts — keep calling with the returned offset until you have what you need, not necessarily to the end.
4. When answering:
   - name the meeting and its date for every fact you use, so the user can find it;
   - speakers are "Speaker A/B/C" — infer names only from what is said in the conversation and say when you're guessing;
   - answer in the user's language, whatever language the meeting was in;
   - for several meetings (e.g. a project's history), go in date order and point out decisions that changed later.
