import { NextResponse } from "next/server";

const TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL ?? "gpt-4o-mini-transcribe";

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "OPENAI_API_KEY is not configured for speech transcription." },
      { status: 500 },
    );
  }

  let incoming: FormData;
  try {
    incoming = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid multipart form data." }, { status: 400 });
  }

  const file = incoming.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "An audio file is required." }, { status: 400 });
  }

  const formData = new FormData();
  formData.append("file", file, file.name || "recording.webm");
  formData.append("model", TRANSCRIBE_MODEL);

  try {
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      body: formData,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      return NextResponse.json(
        { error: `Transcription failed (${res.status}). ${detail.slice(0, 200)}`.trim() },
        { status: 502 },
      );
    }

    const data = (await res.json()) as { text?: string };
    return NextResponse.json({ text: data.text ?? "" });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Transcription request failed.",
      },
      { status: 502 },
    );
  }
}
