# Workflow and stack (repo)

## Dependencies (`package.json`)

- `next` 16.2.1, `react` / `react-dom` 19.x, `typescript` 5.x
- `tailwindcss` 4, `@tailwindcss/postcss` 4, `framer-motion`, `lucide-react`, `clsx`, `tailwind-merge`

## Runtime integrations

| Integration | Where | Env / notes |
|-------------|--------|-------------|
| OpenAI Chat Completions (sharks) | `lib/pitch/callGeminiForShark.ts` | `OPENAI_API_KEY`, `OPENAI_SHARK_MODEL`, `OPENAI_SHARK_FALLBACK_MODEL` |
| OpenAI Chat Completions (soft pass normalizer) | `lib/pitch/classifySoftPassDecision.ts` | `OPENAI_API_KEY`, `OPENAI_DECISION_MODEL` (optional, falls back to scoring model) |
| OpenAI Chat Completions (scores) | `app/api/pitch/turn/route.ts` → `scoreShark` | `OPENAI_API_KEY`, `OPENAI_SCORING_MODEL` (optional) |
| Perplexity | `app/api/pitch/start/route.ts` | `PERPLEXITY_API_KEY`, model `sonar`, `fetch` timeout 5000 ms |
| ElevenLabs TTS | `lib/elevenlabs.ts` | `ELEVEN_LABS_API_KEY` (or `ELEVEN_API_KEY`), `ELEVEN_VOICE_AGENT1` / `AGENT2` / `AGENT3` |
| Session store | `lib/session/memory-store.ts` | In-process `Map`; cleared on server restart |
| Speech-to-text (browser) | `hooks/useSpeechRecognition.ts` | `window.SpeechRecognition` / `webkitSpeechRecognition` |

## HTTP sequence (pitch mode)

1. `POST /api/session/init` body `{ "entry": "pitch" }` → `{ "sessionId" }`. Client stores `sessionId` in `sessionStorage` key `shark_session_id` (`hooks/useOrCreateSessionId.ts`).

2. `POST /api/session/ping` body `{ "sessionId" }` → `{ "ok": true }` when revalidating a stored id. Returns 404 if session is gone (replaced the old `__ping__` message sent to `/api/pitch/turn`).

3. User submits pitch: `POST /api/pitch/start` body `{ "sessionId", "pitchText" }` → updates session (`business`, optional `marketContext`).

4. `POST /api/pitch/turn` body `{ "sessionId", "message": "<pitch text>" }` → round 1 shark lines; `app/api/pitch/turn/route.ts` calls OpenAI per shark for round 1.

5. When `awaitingUserAfterRound1` is true in responses, next user message is treated as round 2 bridge (`isRound1Bridge` in `route.ts`).

6. Further `POST /api/pitch/turn` with user messages: round 2 logic until `nextRound` becomes 3 per `route.ts` conditions.

7. Client `components/modes/PitchMode.tsx` `advanceRound(3)` schedules `executeTurn("__round_start__")` after overlay timeout.

8. End: JSON includes `shouldEndPitch`, `outcome`, `endData`. Client sets `sessionStorage["shark_results"]` and `router.push` to `/results/deal` | `/results/no-deal` | `/results/game-over`.

9. Optional: `POST /api/pitch/turn` message `__accept__mark__` | `__accept__kevin__` | `__accept__barbara__` when that shark has an offer (`respondAcceptOffer` in `route.ts`).

## Client behavior (`components/modes/PitchMode.tsx`)

- Speech queue: `speechQueue` state; `shuffleArray` on `data.lines` and `data.reactionLines` when present.
- `parseSharkResponse` strips trailing JSON from model text before display/TTS.
- Skip: `skipAllSpeech` clears queue and appends messages.

## Files

| Role | Path |
|------|------|
| Landing | `app/page.tsx` → link to `/pitch` |
| Pitch UI | `components/modes/PitchMode.tsx` |
| Start API | `app/api/pitch/start/route.ts` |
| Turn API | `app/api/pitch/turn/route.ts` |
| Session init | `app/api/session/init/route.ts` |
| Session ping | `app/api/session/ping/route.ts` |
| Research chat | `app/api/research/chat/route.ts` |
| Research complete | `app/api/research/complete/route.ts` |
| Speech transcribe | `app/api/speech/transcribe/route.ts` |
| Types | `lib/types/index.ts` |

## Other docs

- `hard-requirements.md` — same behaviors as checklist.
- `ai-shark-tank-plan-v2.md` — index pointing to this file and `hard-requirements.md`.
