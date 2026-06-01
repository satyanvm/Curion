function getOpenAiApiKey(explicitApiKey: string | undefined) {
  return (
    explicitApiKey ||
    process.env.OPENAI_API_KEY ||
    process.env.openai_api_key ||
    process.env.CURION_LLM_API_KEY ||
    process.env.curion_llm_api_key
  );
}

function getOpenAiModel(isVisionRequest: boolean) {
  if (isVisionRequest) {
    return (
      process.env.OPENAI_VISION_MODEL ||
      process.env.openai_vision_model ||
      process.env.review_model ||
      process.env.OPENAI_MODEL ||
      process.env.model ||
      "gpt-4.1-mini"
    );
  }
  return process.env.OPENAI_MODEL || process.env.openai_model || process.env.model || "gpt-4.1-mini";
}

function getOpenAiBaseUrl() {
  return (
    process.env.BASE_URL ||
    process.env.base_url ||
    process.env.OPENAI_BASE_URL ||
    process.env.openai_base_url ||
    "https://api.openai.com/v1"
  ).replace(/\/+$/, "");
}

function getChatCompletionsUrl() {
  const baseUrl = getOpenAiBaseUrl();
  if (/\/chat\/completions$/i.test(baseUrl)) return baseUrl;
  if (/\/v1$/i.test(baseUrl)) return `${baseUrl}/chat/completions`;
  return `${baseUrl}/v1/chat/completions`;
}

function getOpenAiWireApi() {
  const baseUrl = getOpenAiBaseUrl().toLowerCase();
  const wireApi = String(
    process.env.OPENAI_WIRE_API ||
      process.env.WIRE_API ||
      process.env.wire_api ||
      process.env.OPENAI_API_TYPE ||
      ""
  ).toLowerCase();
  if (wireApi === "responses" || wireApi === "response") return "responses";
  if (String(process.env.model_provider || process.env.MODEL_PROVIDER || "").toLowerCase() === "codex-everywhere") {
    return "responses";
  }
  if (baseUrl.includes("codex-everywhere.com")) return "responses";
  return "chat";
}

function getResponsesUrl() {
  const baseUrl = getOpenAiBaseUrl();
  if (/\/responses$/i.test(baseUrl)) return baseUrl;
  if (/\/v1$/i.test(baseUrl)) return `${baseUrl}/responses`;
  return `${baseUrl}/v1/responses`;
}

export function isOpenAiConfigured(explicitApiKey?: string) {
  return Boolean(getOpenAiApiKey(explicitApiKey) && typeof fetch === "function");
}

function redactSensitiveText(text: string) {
  return text.replace(/sk-[^"\s]+/g, "sk-REDACTED");
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableStatus(status: number) {
  return status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}

function retryDelayMs(attempt: number, response?: Response) {
  const retryAfter = response?.headers.get("retry-after");
  const retryAfterSeconds = retryAfter ? Number(retryAfter) : 0;
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, 10000);
  }
  return Math.min(500 * 2 ** attempt, 4000);
}

function responseText(choice: any) {
  const rawContent = choice?.message?.content;
  if (typeof rawContent === "string") return rawContent.trim();
  if (Array.isArray(rawContent)) {
    return rawContent.map((part) => part?.text || "").join("").trim();
  }
  return "";
}

function responsesText(response: any) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }

  return (response?.output || [])
    .flatMap((item: any) => item?.content || [])
    .map((part: any) => (part?.type === "output_text" || !part?.type ? part?.text || "" : ""))
    .join("")
    .trim();
}

function envBoolean(name: string, fallback = false) {
  const value = process.env[name] ?? process.env[name.toLowerCase()];
  if (value === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(value);
}

function responsesRequestBody(model: string, systemInstruction: string, payload: unknown, imageDataUrl?: string) {
  const userContent: Array<Record<string, string>> = [{ type: "input_text", text: JSON.stringify(payload) }];
  if (imageDataUrl) {
    userContent.push({ type: "input_image", image_url: imageDataUrl });
  }

  const reasoningEffort =
    process.env.OPENAI_REASONING_EFFORT ||
    process.env.openai_reasoning_effort ||
    process.env.model_reasoning_effort;
  const body: Record<string, unknown> = {
    model,
    input: [
      {
        role: "system",
        content: [
          {
            type: "input_text",
            text: `${systemInstruction}\nReturn strict JSON only. Do not include markdown.`
          }
        ]
      },
      {
        role: "user",
        content: userContent
      }
    ],
    text: {
      format: { type: "json_object" }
    },
    store: !envBoolean("disable_response_storage", false) && !envBoolean("OPENAI_DISABLE_RESPONSE_STORAGE", false)
  };

  if (reasoningEffort) {
    body.reasoning = { effort: reasoningEffort };
  }

  return JSON.stringify(body);
}

function chatRequestBody(model: string, systemInstruction: string, payload: unknown, imageDataUrl?: string) {
  const userContent = imageDataUrl
    ? [
        { type: "text", text: JSON.stringify(payload) },
        { type: "image_url", image_url: { url: imageDataUrl } }
      ]
    : JSON.stringify(payload);

  return JSON.stringify({
    model,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: `${systemInstruction}\nReturn strict JSON only. Do not include markdown.`
      },
      {
        role: "user",
        content: userContent
      }
    ]
  });
}

export async function generateJsonWithOpenAI(
  systemInstruction: string,
  payload: unknown,
  options: { apiKey?: string; imageDataUrl?: string } = {}
) {
  const apiKey = getOpenAiApiKey(options.apiKey);
  if (!apiKey || typeof fetch !== "function") {
    throw new Error("OpenAI API key is not configured");
  }

  const isVisionRequest = Boolean(options.imageDataUrl);
  const model = getOpenAiModel(isVisionRequest);
  const wireApi = getOpenAiWireApi();
  const endpoint = wireApi === "responses" ? getResponsesUrl() : getChatCompletionsUrl();
  const requestBody =
    wireApi === "responses"
      ? responsesRequestBody(model, systemInstruction, payload, options.imageDataUrl)
      : chatRequestBody(model, systemInstruction, payload, options.imageDataUrl);

  let response: Response | undefined;
  const maxAttempts = Number(process.env.OPENAI_MAX_ATTEMPTS || process.env.openai_max_attempts || 3);
  for (let attempt = 0; attempt < Math.max(1, maxAttempts); attempt += 1) {
    response = await fetch(endpoint, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      },
      body: requestBody
    });

    if (response.ok || !isRetryableStatus(response.status) || attempt === Math.max(1, maxAttempts) - 1) {
      break;
    }

    await sleep(retryDelayMs(attempt, response));
  }

  if (!response?.ok) {
    const status = response?.status ?? 0;
    const detail = response ? await response.text().catch(() => "") : "";
    throw new Error(
      [
        `OpenAI request failed with status ${status}`,
        `endpoint=${endpoint}`,
        `model=${model}`,
        `wire_api=${wireApi}`,
        detail ? `detail=${redactSensitiveText(detail)}` : ""
      ]
        .filter(Boolean)
        .join(" ")
    );
  }

  const json = await response.json();
  const content = wireApi === "responses" ? responsesText(json) : responseText(json.choices?.[0]);
  if (!content) {
    throw new Error("OpenAI response was empty");
  }
  return content;
}
