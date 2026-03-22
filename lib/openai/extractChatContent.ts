/**
 * Normalize OpenAI Chat Completions `choices[0].message.content`.
 * Some models return multimodal part arrays; reasoning models may use alternate shapes.
 */
export function extractChatCompletionText(data: unknown): string {
  const d = data as {
    choices?: { message?: { content?: unknown } }[];
  };
  const c = d?.choices?.[0]?.message?.content;
  if (typeof c === "string") return c;
  if (Array.isArray(c)) {
    return c
      .map((part) => {
        if (typeof part === "string") return part;
        if (part && typeof part === "object" && "text" in part) {
          return String((part as { text?: string }).text ?? "");
        }
        return "";
      })
      .join("");
  }
  return "";
}
