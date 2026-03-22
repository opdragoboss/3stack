import type { SharkId, SharkLine } from "@/lib/types";

const VOICE_ENV_BY_SHARK: Record<SharkId, string> = {
  mark: "ELEVEN_VOICE_AGENT1",
  kevin: "ELEVEN_VOICE_AGENT2",
  barbara: "ELEVEN_VOICE_AGENT3",
};

const TTS_URL = "https://api.elevenlabs.io/v1/text-to-speech";

/** Text that will be spoken — strips structured decision JSON so it is never read aloud. */
export function stripSpokenText(raw: string): string {
  let t = raw.trim();
  t = t.replace(/\n*```json\s*\n[\s\S]*?```\s*$/i, "");
  t = t.replace(/\n*```\s*\n[\s\S]*?```\s*$/, "");
  t = t.trim();

  const lastBrace = t.lastIndexOf("}");
  if (lastBrace === -1) return t;

  let depth = 0;
  let start = -1;
  for (let i = lastBrace; i >= 0; i--) {
    const ch = t[i];
    if (ch === "}") depth++;
    else if (ch === "{") {
      depth--;
      if (depth === 0) {
        start = i;
        break;
      }
    }
  }
  if (start === -1) return t;

  const candidate = t.slice(start, lastBrace + 1);
  try {
    const p = JSON.parse(candidate) as { decision?: string };
    if (p.decision === "offer" || p.decision === "counter" || p.decision === "pass") {
      return t.slice(0, start).trim();
    }
  } catch {
    /* not JSON */
  }
  return t;
}

export function getElevenLabsConfig(): { apiKey: string } | null {
  const apiKey = process.env.ELEVEN_LABS_API_KEY?.trim();
  if (!apiKey) return null;
  return { apiKey };
}

export function getVoiceIdForShark(sharkId: SharkId): string | undefined {
  const name = VOICE_ENV_BY_SHARK[sharkId];
  const id = process.env[name]?.trim();
  return id || undefined;
}

export async function synthesizeMp3DataUrl(
  text: string,
  voiceId: string,
  apiKey: string,
): Promise<string> {
  const res = await fetch(`${TTS_URL}/${encodeURIComponent(voiceId)}`, {
    method: "POST",
    headers: {
      "xi-api-key": apiKey,
      "Content-Type": "application/json",
      Accept: "audio/mpeg",
    },
    body: JSON.stringify({
      text,
      model_id: "eleven_multilingual_v2",
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`ElevenLabs TTS failed (${res.status}): ${detail.slice(0, 200)}`);
  }

  const buf = Buffer.from(await res.arrayBuffer());
  return `data:audio/mpeg;base64,${buf.toString("base64")}`;
}

export async function enrichSharkLinesWithTts(lines: SharkLine[]): Promise<SharkLine[]> {
  const cfg = getElevenLabsConfig();
  if (!cfg) return lines;

  return Promise.all(
    lines.map(async (line) => {
      const voiceId = getVoiceIdForShark(line.sharkId);
      if (!voiceId) return line;
      const spoken = stripSpokenText(line.text);
      if (!spoken.trim()) return line;
      try {
        const audioUrl = await synthesizeMp3DataUrl(spoken, voiceId, cfg.apiKey);
        return { ...line, audioUrl };
      } catch (e) {
        console.error("[ElevenLabs] TTS error", line.sharkId, e);
        return line;
      }
    }),
  );
}
