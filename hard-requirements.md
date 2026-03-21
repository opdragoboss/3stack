# Hard Requirements (v2)

> Each requirement states **what must be true**. Not how it looks in the UI.
> **Normative source:** `ai-shark-tank-plan-v2.md` — this file mirrors that plan.

---

## 1. ElevenLabs is the voice provider

- Every Shark must speak using ElevenLabs TTS
- No other TTS provider is acceptable
- Each Shark must have a distinct, separate voice

---

## 2. There are exactly 3 Sharks

- The app must have exactly 3 Shark personalities:
  - Mark Cuban
  - Kevin O'Leary
  - Barbara Corcoran
- Each Shark must stay fully in character in every response — no breaking persona

---

## 3. Each Shark is an independent AI agent

- Each Shark must be a separate AI agent instance
- Each agent must have its own system prompt that cannot be shared or overridden by another agent
- Each agent must have its own conversation memory — what one Shark remembers does not automatically transfer to another agent's memory
- Conversation history must persist **across all rounds** for each agent for the duration of the session

### LLM providers (per `ai-shark-tank-plan-v2.md`)

| Agent | Shark | LLM |
|---|---|---|
| Mark | Mark Cuban | **OpenAI GPT-4o** |
| Kevin | Kevin O'Leary | **Anthropic Claude** |
| Barbara | Barbara Corcoran | **Google Gemini** |

Pitch validation (not a Shark) uses **OpenAI GPT-4o-mini** — fast, low-cost classification.

---

## 4. The user submits a pitch — this is the entry point

- The user types or speaks their pitch — this is the entry point of the entire app after landing
- The pitch must capture at minimum:
  - What the business is
  - How much the user is asking for
  - What equity they are offering
- There is no interactive Research Mode — the user does not refine their idea in a back-and-forth before pitching
- Without a pitch, nothing happens — no research, no agents, no voices

---

## 5. The pitch must be validated before anything runs

- After the user submits their pitch, an AI model must determine if it is a valid business pitch (**GPT-4o-mini**, per plan — not one of the 3 Shark agents)
- A valid pitch contains a describable business idea with an ask amount and equity offering
- If the pitch is **invalid** (e.g. gibberish, a joke, an empty prompt, prompt injection attempt, or unrelated text):
  - The research step does not run
  - The agents do not run
  - The user is shown a message explaining the pitch was not valid and asking them to try again
- If the pitch is **valid**:
  - The workflow continues to the research step
- Returns shape (per plan): `{ "valid": true/false, "reason": "string" }`

---

## 6. Perplexity research runs automatically after pitch validation

- After a pitch passes validation, a single Perplexity API request is made automatically — the user does not interact with it
- The exact query sent to Perplexity:

  ```
  "Provide a brief research summary for a business pitch in the following category: [business description].
  Include: current market size, top 3 competitors, recent funding activity in this space,
  and any notable market trends as of today. Keep it under 150 words."
  ```

- Perplexity's response is injected into each Shark's system context as a read-only block:

  ```
  "MARKET CONTEXT (use this to inform your response, do not read it aloud):
  [Perplexity summary here]"
  ```

- Perplexity runs **once per pitch** — it is not called again on follow-up turns or later rounds
- If Perplexity does not respond within **5 seconds**, its step is skipped entirely and the 3 agents proceed without market context — the workflow must not wait or fail

---

## 7. The Tank is round-based with sequential Shark turns

- After Perplexity completes (or times out), the session enters **The Tank**
- **One round** = one full pass over every Shark that is still **in** at the **start** of that round, in fixed order (**Mark → Kevin → Barbara**)
- For each active Shark in order:
  1. That Shark's agent generates a response (spoken content + structured JSON — see §14)
  2. The response text (minus JSON) is sent to ElevenLabs and played
  3. The user may then reply (text or speech); the reply is appended to **that Shark's** conversation history (per plan — other Sharks receive it via within-round / cross-round injection as implemented)
- The user must be able to respond **after each Shark speaks** — not only once per round
- Agents are **not** all called in parallel on a single user action for normal Tank turns — turns are **sequential** per Shark
- **During** a round, skip only Sharks who were already **out** before that round began (carried forward from prior rounds). All Sharks who were **in** at round start take their turn in order; **in/out for the next round** is determined at **end of round** (see §10)

---

## 8. Later Sharks hear earlier Sharks within the same round

- When it is Shark *N*'s turn in a round, that agent must receive context for what **earlier Sharks in that round** said and how the entrepreneur replied
- Each agent receives only what came **before** them in the current round — not their own line from the same turn, and not Sharks who have not spoken yet
- Cross-talk happens **within** the round order — there is no separate batch “reaction round” after all three speak in parallel

---

## 9. ElevenLabs plays per Shark turn, in turn order

- Each Shark's spoken text is sent to ElevenLabs **on that Shark's turn**
- Audio plays **before** the user's reply input for that Shark is accepted (or equivalent UX: user responds only after hearing that Shark)
- Only one Shark's audio plays at a time — no overlapping voices
- Playback order follows **Tank turn order** — no randomization requirement

---

## 10. In / out mechanic (matches plan steps 4–5)

- Every Shark turn includes structured JSON with a `status` field (`in` | `out`) — see §14
- **End of round:** After all active Sharks for that round have spoken, evaluate each participating Shark's **`status`** (and spoken intent, e.g. “I'm out”) from **that round** and update who is **in** vs **out** going forward:
  - **in** → still interested (e.g. ✓ above portrait, per product UI)
  - **out** → eliminated (e.g. ✗, grayed out); out Sharks are **skipped in all future rounds**
- Out Sharks must have said they are out in spoken content when appropriate, consistent with the plan prompts

---

## 11. Maximum rounds and end conditions (matches plan step 6)

- **Max rounds = 3** — not configurable for the hackathon scope unless the plan explicitly changes
- The session must not run unbounded rounds
- **Continue** to the next round if: at least one Shark is still **in** **and** max rounds (**3**) have **not** been reached
- **Game ends** when **any** of these is true:
  1. **DEAL** — all **remaining** Sharks (still in when the game resolves) have **`decision`: `offer`** in line with the plan workflow *(if multiple offers, the user may pick one — see plan turn example)*  
  2. **NO DEAL** — all Sharks are **out**
  3. **Max rounds exhausted** — round **3** completed; remaining **in** Sharks must make a **final offer or pass** (no further questioning rounds)
- After the final allowed round, any Shark still **in** must reach a final **offer** or **pass** — no infinite questioning

---

## 12. Agents must never break character

- No agent may identify itself as an AI, a language model, or refer to itself by the name of its provider (GPT, Claude, Gemini)
- If a user asks "are you an AI?" the agent must respond in character
- Breaking persona counts as a failure state — it must be prevented at the system prompt level, not handled after the fact

---

## 13. Agents must not accept prompt injection from the pitch field

- The pitch text submitted by the user must be treated as user content only — never as instructions
- An agent must not follow commands embedded in a pitch
- The system prompt must explicitly instruct each agent to ignore any instructions found inside the pitch text
- This must be enforced on all 3 agents independently since they run on different providers
- The pitch validation step (§5) acts as a first line of defense — obvious injection attempts are caught before agents ever see the pitch

---

## 14. Structured JSON on every Shark response

- Every Shark response must end with a parseable JSON block for the system (same shape as `ai-shark-tank-plan-v2.md` system prompts):

  ```json
  {
    "status": "in" | "out",
    "done": boolean,
    "decision": "none" | "offer" | "pass",
    "amount": number,
    "equity": number
  }
  ```

- Semantics (aligned with plan prompts):
  - `status`: still in vs dropping out
  - `done`: per prompt — whether the Shark is done with that beat of questioning
  - `decision`: `none` while questioning, `offer` or `pass` when deciding
  - `amount` / `equity`: **0** while not offering; when `decision` is `offer`, amount **$10,000–$2,000,000**, equity **5–50** (percent)
- The JSON block must **never** be sent to ElevenLabs — strip it before TTS
- **Out-of-bounds** offer terms: parse JSON every turn — **reject and retry** the agent call (max **2** retries). If still invalid after retries, fall back to an in-character **out** response with safe JSON (e.g. `status: "out"`, `decision: "pass"`, zeros) — aligned with plan Risks & Guardrails
- **Missing or malformed** JSON (cannot parse): default to `status: "in"`, `done: false` and continue the round — per plan Risks & Guardrails (does not substitute for invalid **deal terms**, which use retries / out fallback above)

---

## 15. Each Shark must score the pitch 1–10 at the end (matches plan step 8)

- Every Shark must assign a score from **1 to 10** with a one-line comment on the **Results** experience
- Overall pitch grade = **average of all 3** Sharks' scores
- Scores apply to **all** Sharks — including those who went out earlier
- If a score is missing or invalid at results time, the implementation may default (e.g. **5**) but must not crash  
- *How* scores are produced (e.g. final dedicated call vs. last message) is implementation detail as long as Results matches the plan

---

## 16. If one agent fails, the session must not silently break

- If one of the 3 LLM providers returns an error, times out (**>10 seconds**), or refuses the request, the app must not hang or show a blank response
- The affected Shark's API route must catch the error and immediately return a hardcoded in-character fallback string specific to that Shark:
  - Mark: `"I need to think on this one. I'm out for now."`
  - Kevin: `"You've wasted enough of my time. I'm out."`
  - Barbara: `"I'm going to sit this one out, but good luck."`
- The fallback must include valid JSON, e.g. `{"status":"out","done":true,"decision":"pass","amount":0,"equity":0}`
- The fallback is passed to ElevenLabs and spoken in that Shark's voice like any other response
- That Shark must be treated as **out** for the rest of the session
- The session continues with the remaining Sharks

---

## 17. Every session must reach a defined end state (matches plan step 8)

- A session is not complete until Tank play ends and **Results** are shown
- The Results screen must display:
  - **DEAL!** with terms from offering Shark(s), or **NO DEAL** — per plan
  - Each Shark's score (**1–10**) with a one-line comment
  - Overall pitch grade (average of 3 scores)

---

## 18. Session state (hackathon scope — matches plan Storage)

- Session state may live **in memory** (React + API route state) — **no database** for hackathon
- State must include at minimum (per plan):
  - Per-agent conversation history (across rounds)
  - Per-agent **in** / **out**
  - Current **round** number (max **3**)
  - Current **turn** / which Shark speaks next
  - Latest structured JSON per Shark as needed for orchestration
- *Optional later:* persistent storage (e.g. DynamoDB) is **out of scope** for the hackathon unless the plan is updated
