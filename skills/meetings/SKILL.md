---
name: meetings
description: Use when the user asks about their meetings or calls recorded with MeetingRecorder — what was discussed or decided, action items and owners, what someone said, a meeting's summary, preparing for a follow-up, bringing meeting notes into a project or document, or connecting recorded meetings with calendar events (who attended, follow-ups).
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

## With a calendar

When a calendar connector is also available (Google Calendar, Outlook, or a calendar app), use it to fill in what the recording doesn't know:

- **Match the recording to its event.** Look for an event on the same day that overlaps the recording's start time (recordings often start a few minutes early or late). Recording times are the Mac's local time; check the calendar's time zone before comparing. If several events fit, or none does, say so instead of guessing.
- **Take from the event:** its title, attendees and agenda/description. Use attendee names to work out who Speaker A/B/C is, but only when the conversation backs it up (people addressing each other by name, introductions, the organizer's role), and say which mapping is inferred.
- **Without being asked**, use calendar data only to answer better (names, the event title). Don't fetch the calendar for every meeting in a long list — only for the meetings you're actually discussing.

Writing to the calendar happens only when the user asks for it:

- follow-up meetings: propose the title, time, attendees and a short agenda from the agreed next steps, and create the event after the user confirms;
- notes on an existing event: other attendees can see an event's description, so before adding a summary to an event with other people on it, say so and ask; never overwrite an existing description — add below it.

