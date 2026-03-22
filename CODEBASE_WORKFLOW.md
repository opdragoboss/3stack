# FishBowl Codebase Workflow (Plain English)

This document explains how the app works from start to finish, in normal language.

---

## 1) What this app is

`3stack` (UI name: **FishBowl**) is a Shark Tank style pitch simulator built with Next.js.

You type (or speak) a startup pitch, and three AI sharks react across three rounds:

1. **The Pitch** (first reactions)
2. **The Grilling** (questions/challenges)
3. **The Decision** (offer/counter/pass)

At the end, the app shows either:

- **Deal** (you got an offer you accepted, or a deal outcome), or
- **No Deal**

It also produces shark scoring and improvement tips.

---

## 2) Big picture architecture

The app is mostly split into:

- **Client UI** (React components in `app/` and `components/`)
- **API routes** (server logic in `app/api/**/route.ts`)
- **Shared business logic** (in `lib/`)
- **In-memory session store** (in `lib/session/memory-store.ts`)

Important note: session data is stored in a server-side `Map` in memory.  
If the dev server restarts, sessions are lost.

---

## 3) Main pages and what they do

- `app/page.tsx`  
  Immediately redirects to `/pitch`.

- `app/pitch/page.tsx`  
  Main gameplay screen. Renders the big `PitchMode` component.

- `app/research/page.tsx`  
  Optional research chat screen (`ResearchMode`).

- `app/results/deal/page.tsx`  
  Deal outcome screen.

- `app/results/no-deal/page.tsx`  
  No-deal outcome screen (also shows improvement tips).

- `app/results/game-over/page.tsx`  
  Redirects to no-deal page.

---

## 4) Session lifecycle (how a user session starts and survives)

The browser stores one session id in `sessionStorage` as `shark_session_id`.

Flow:

1. Client calls `POST /api/session/init` with `{ entry: "pitch" | "research" }`.
2. Server creates a new session snapshot in memory and returns `{ sessionId }`.
3. On future loads, client validates old id with `POST /api/session/ping`.
4. If ping fails (session gone/ended), client clears storage and creates a fresh session.

This logic lives in:

- `hooks/useOrCreateSessionId.ts`
- `app/api/session/init/route.ts`
- `app/api/session/ping/route.ts`
- `lib/session/memory-store.ts`

---

## 5) Pitch mode: end-to-end flow

This is the core product flow.

## A. User opens `/pitch`

`PitchMode` initializes:

- UI phase state (`prestart`, `waiting_session`, `ready_to_pitch`, `in-tank`, etc.)
- Round state (`1`, `2`, `3`)
- Chat message list
- Deal board state (offers and passed sharks)
- Speech queue and optional audio playback state

If `requireStart` is true, user sees a **Start Pitch** button before entering.

## B. User submits first pitch

When user sends first real pitch:

1. Client calls `POST /api/pitch/start` with `{ sessionId, pitchText }`.
2. Server does quick quality checks:
   - pitch too short, or
   - too many red flags
3. If not skipped, server tries one best-effort Perplexity market brief (short timeout).
4. Server stores:
   - `pitch.business`
   - optional `pitch.marketContext`
5. Server returns structured research metadata.

Client then transitions to in-tank flow and sends the same pitch text to turn API.

## C. Turn-by-turn gameplay

Client calls `POST /api/pitch/turn` with `{ sessionId, message }`.

Server route (`app/api/pitch/turn/route.ts`) is the main game engine:

- Loads session
- Handles special protocol messages:
  - `__accept__<sharkId>__` for accepting a live offer
  - `__round_start__` for starting round 3 transition behavior
  - `__ping__` lightweight status
- Updates running state:
  - out sharks
  - offers
  - thread transcript
  - red-flag score
  - low-effort counters
  - question counters

Then behavior differs by round:

- **Round 1**: all active sharks respond sequentially.
- **Round 2**: one shark responds per user message (weighted so quieter sharks speak more).
- **Round 3**: all active sharks make final decision beat.

Server parses each shark model response, enforces valid structure/terms, and applies retries or fallbacks if needed.

## D. Shark responses and voice

For each shark turn:

1. Prompt payload is built (`lib/agents/buildSharkPayload.ts`)
2. OpenAI chat completion is called (`lib/pitch/callGeminiForShark.ts`)
3. Response is parsed (`lib/pitch/parseSharkResponse.ts`)
4. Invalid or ambiguous decisions are repaired/fallbacked
5. Optional ElevenLabs TTS audio URLs are attached (`lib/elevenlabs.ts`)

On client, lines are queued and played:

- If audio URL exists -> play audio
- Else -> text streaming fallback effect
- User can press **Skip dialogue** to flush queue immediately

## E. Ending a pitch

A pitch can end when:

- All sharks are out, or
- Final round completes with no viable continuation, or
- Founder accepts a live offer using `__accept__<sharkId>__`

When ending:

1. Server computes shark scores (OpenAI or safe fallback)
2. Server generates improvement tips (OpenAI or fallback tips)
3. Server returns `shouldEndPitch: true` and `endData`
4. Client stores `endData` in `sessionStorage["shark_results"]`
5. Client navigates to results page:
   - `/results/deal` or
   - `/results/no-deal`

---

## 6) Research mode flow

Research mode is wired but currently lightweight/stubbed:

- `POST /api/research/chat`: stores user + assistant messages in session
- Assistant reply is currently a placeholder text
- `POST /api/research/complete`: marks research complete and writes a stub summary into `pitch.marketContext`

So the structure exists, but full production LLM research chat is not fully implemented yet.

---

## 7) Speech input flow (microphone -> transcript)

Client hook `useSpeechRecognition` does this:

1. Uses `MediaRecorder` + `getUserMedia` to capture audio blob.
2. Sends blob to `POST /api/speech/transcribe`.
3. Server forwards file to OpenAI audio transcription endpoint.
4. Returned text is inserted into the pitch textarea.

This is why mic input works like "fill text box first, then press Send."

---

## 8) Data model in plain words

Core shared types are in `lib/types/index.ts`.

Most important session fields:

- `pitch.round`: current round number
- `pitch.out`: sharks who are out for good
- `pitch.conversationThread`: full shared room conversation
- `pitch.roundTurns`: transcript for current round
- `pitch.fullTranscript`: cumulative completed-round history
- `pitch.offers`: current live offers by shark
- `pitch.awaitingUserAfterRound1`: waiting for founder bridge into round 2
- `pitch.awaitingFounderDecision`: live offers available for accept/counter
- `endState`: `active`, `deal`, `no_deal`, or `game_over`

---

## 9) Third-party integrations and why they exist

- **OpenAI chat completions**
  - Shark dialogue generation
  - Soft-pass classification
  - End scoring
  - Improvement tips generation

- **Perplexity**
  - One market brief fetch at pitch start (best effort, timeout-safe)

- **ElevenLabs**
  - Optional shark voice audio for each line

If these APIs are missing/fail, code generally falls back and continues gameplay instead of hard-crashing.

---

## 10) What happens on refresh or restart

- Browser refresh: session id may persist in `sessionStorage`.
- Server restart: in-memory session map clears.
- Client ping detects dead session and auto-creates a new one.

So state persistence is **session-like**, not durable database persistence.

---

## 11) Practical "from click to result" sequence

1. User lands on `/pitch`.
2. Session initialized/validated.
3. User enters first pitch and submits.
4. `/api/pitch/start` runs validation + optional Perplexity market brief.
5. `/api/pitch/turn` runs round logic and returns shark lines (+ optional TTS URLs).
6. Client renders shark chat + deal board and keeps exchanging turns.
7. Server eventually returns final outcome and end data.
8. Client stores `shark_results` and navigates to result page.
9. Result page reads `shark_results` and displays grade, scores, deal/no-deal feedback.

---

## 12) Current implementation reality (important)

- Pitch mode is the most complete and production-like path.
- Research mode is partially stubbed.
- Session storage is in-memory only (good for demo/dev, not persistent backend).
- Result pages can show placeholder data if `shark_results` is missing or malformed.

