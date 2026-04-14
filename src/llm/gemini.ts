function getGeminiApiKey(): string | undefined {
  return process.env.GEMINI_API_KEY ?? process.env.gemini_api_key;
}

function getGeminiModel(): string {
  return process.env.GEMINI_MODEL ?? process.env.gemini_model ?? "gemini-2.5-flash";
}

type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
      }>;
    };
  }>;
};

export function isGeminiConfigured(): boolean {
  return Boolean(getGeminiApiKey() && typeof fetch === "function");
}

export async function generateJsonWithGemini(
  systemInstruction: string,
  payload: unknown
): Promise<string> {
  const apiKey = getGeminiApiKey();
  if (!apiKey || typeof fetch !== "function") {
    throw new Error("Gemini API key is not configured");
  }

  const model = getGeminiModel();
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemInstruction }],
      },
      contents: [
        {
          role: "user",
          parts: [
            {
              text: JSON.stringify(payload),
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json",
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`Gemini request failed with status ${response.status}`);
  }

  const json = (await response.json()) as GeminiResponse;
  const content = json.candidates?.[0]?.content?.parts?.map((part) => part.text ?? "").join("").trim();

  if (!content) {
    throw new Error("Gemini response was empty");
  }

  return content;
}
