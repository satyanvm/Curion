import { Page } from "playwright";
import { FieldType, FormField } from "../types/types";
import { generateJsonWithGemini, isGeminiConfigured } from "./gemini";

type LlmField = {
  label?: string;
  selector?: string;
  type?: string;
};

function normalizeFieldType(type: string | undefined): FieldType {
  const normalizedType = (type ?? "").toLowerCase();

  if (normalizedType === "textarea") return "textarea";
  if (normalizedType === "select") return "select";
  if (normalizedType === "checkbox") return "checkbox";
  if (normalizedType === "radio") return "radio";
  if (normalizedType === "email") return "email";
  if (normalizedType === "tel") return "tel";
  if (normalizedType === "url") return "url";
  if (normalizedType === "number") return "number";
  if (normalizedType === "password") return "password";
  if (normalizedType === "text") return "text";

  return "unknown";
}

export async function extractFieldsWithLLM(page: Page): Promise<FormField[]> {
  if (!isGeminiConfigured()) {
    return [];
  }

  const html = await page.content();
  const htmlSnippet = html.slice(0, 25000);

  try {
    const content = await generateJsonWithGemini(
      "Extract likely fillable form fields from the provided HTML. Return strict JSON with a top-level 'fields' array. Each field must include label, selector, and type. Prefer selectors that use existing ids or names from the HTML. Only include input, textarea, and select elements that a user would fill.",
      {
        url: page.url(),
        html: htmlSnippet,
      }
    );

    const parsed = JSON.parse(content) as { fields?: LlmField[] };
    const fields = parsed.fields ?? [];

    return fields
      .filter((field) => field.label && field.selector)
      .map((field) => ({
        label: field.label!.trim(),
        labelSource: "llm" as const,
        selector: field.selector!.trim(),
        type: normalizeFieldType(field.type),
        tagName: field.type === "textarea" ? "textarea" : field.type === "select" ? "select" : "input",
      }));
  } catch (error) {
    console.warn("LLM field extraction fallback failed:", error);
    return [];
  }
}
