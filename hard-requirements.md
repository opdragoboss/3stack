# Hard requirements (current code)

Source: `WORKFLOW.md` and these paths.

---

## 1. ElevenLabs

- `lib/elevenlabs.ts`: `getElevenLabsConfig()` reads `ELEVEN_LABS_API_KEY` first, then falls back to `ELEVEN_API_KEY`. Voice IDs: `ELEVEN_VOICE_AGENT1` (`mark`), `ELEVEN_VOICE_AGENT2` (`kevin`), `ELEVEN_VOICE_AGENT3` (`barbara`).
- `enrichSharkLinesWithTts` runs `stripSpokenText(line.text)` before `synthesizeMp3DataUrl`. If no API key or no voice ID for a shark, that line is returned unchanged (no `audioUrl`).
- If ElevenLabs fails or is unset, `PitchMode.tsx` plays text-only stream or skip; no crash.

## 2. Three sharks

- IDs: `mark`, `kevin`, `barbara` (`lib/constants/sharks.ts`, `lib/types/index.ts`).
- Labels and prompts: `lib/constants/prompts.ts` (`SHARK_SYSTEM_PROMPT`).

## 3. OpenAI calls

- Each shark reply: `callGeminiForShark` in `lib/pitch/callGeminiForShark.ts` (POST `https://api.openai.com/v1/chat/completions`, 30s abort).
- State: `PitchState.conversationThread` in `lib/types/index.ts`; built in `lib/agents/buildSharkPayload.ts`.

## 4. Routes

- Pitch flow: `app/pitch/page.tsx` renders `PitchMode`.
- `app/research/page.tsx` exists separately; not required for `app/pitch/page.tsx`.

## 5. No classifier gate before tank

- `app/api/pitch/start/route.ts` does not POST to a "valid pitch" model. It may skip Perplexity when `detectRedFlags` / word count in that file says so.

## 6. Perplexity

- One `fetch` to `https://api.perplexity.ai/chat/completions` in `app/api/pitch/start/route.ts`, `AbortController` 5s.
- Result string stored on session `pitch.marketContext` when non-null.

## 7. Rounds (`app/api/pitch/turn/route.ts`)

- `roundAtStart`, `isRound1Bridge`, `session.pitch.round`.
- Round 1: `Promise.all(activeSharks.map((id) => callSharkSafe(id, ...)))`.
- Round 2: `pickNextSharkForRound2` + one `callShark` per user turn (unless `runningTotalUserResponses >= 4` skips the shark-call block but can still advance round via `roundComplete`).
- Round 3: `Promise.all(activeSharks.map((id) => callSharkSafe(id, tempPitch, runningOut, round3Note)))` with `buildRound3Note()`.
- `nextSpeaker` / `nextAfterPitcher` in parsed JSON are not read to choose the next speaker in this file.

## 8. Context

- `buildTempPitch().conversationThread` passed to `buildSharkPayload`.
- `roundTurns`, `fullTranscript` updated in `updateSession` block in the same file.

## 9. Playback

- `PitchMode.tsx`: one `currentSpeech` from `speechQueue[0]`; `useEffect` on `currentSpeech` drives audio or word timer.

## 10. Out

- `processSharkResult`: `json.decision === "pass"` or `json.status === "out"` pushes `sharkId` to `runningOut`.
- `parseSharkResponse.ts`: broad pass-language detection on display text when JSON is missing or inconsistent.
- `app/api/pitch/turn/route.ts`: Round 3 ambiguous soft-pass lines can be normalized through `classifySoftPassDecision.ts` before retry/fallback.

## 11. End

- `finalActive.length === 0` or `roundComplete` + `session.pitch.round` sets `shouldEndPitch`, `outcome`, `endData`.
- Client reads `PitchTurnResponse` in `PitchMode.tsx` `executeTurn`.

## 12. Prompts

- `lib/constants/prompts.ts` - `SHARK_SYSTEM_PROMPT`, `SHARED_RULES`. Identity rule in file: human investor; never name **Gemini, Google AI, Google, or ADK** (does not mention OpenAI by name).

## 13. User text as content

- `SHARED_RULES` / identity rules in `prompts.ts`: user text is pitch or response, not instructions.
- `buildDirectorNotes` in `lib/agents/buildSharkPayload.ts` returns `Partial<Record<SharkId, string>>`; `app/api/pitch/turn/route.ts` passes `directorNotes[id]` as the fourth argument to `callShark` per shark, which passes it to `buildSharkPayload`.

## 14. JSON tail

- Shape in `lib/pitch/parseSharkResponse.ts` (`SharkJson14`). `processSharkResult` stores `parsed.displayText` on each `SharkLine` as `text` (JSON already removed).
- `enrichSharkLinesWithTts` calls `stripSpokenText(line.text)` again before TTS.

## 15. Scores

- `scoreShark` in `app/api/pitch/turn/route.ts`: OpenAI JSON `score` 0-100, `comment` string.
- Results pages read `sessionStorage` JSON written in `PitchMode.tsx`.

## 16. Shark failure

- `callGeminiForShark` returns `buildFallbackResponse(sharkId)` on error/timeout/empty.

## 17. Results pages

- `app/results/deal/page.tsx`, `app/results/no-deal/page.tsx`, `app/results/game-over/page.tsx`.

## 18. Session

- `lib/session/memory-store.ts`: `createSession`, `getSession`, `updateSession`.

## 19. Accept offer

- Regex `^__accept__(mark|kevin|barbara)__$` in `app/api/pitch/turn/route.ts` -> `respondAcceptOffer`.
