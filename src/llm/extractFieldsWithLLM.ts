import { Page } from "playwright";
import { FormField } from "../types/types";
import { parseLlmExtractedFields } from "./fieldParsing";
import { generateJsonWithGemini, isGeminiConfigured } from "./gemini";

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

    const parsed = JSON.parse(content) as {
      fields?: Array<{
        label?: string;
        selector?: string;
        type?: string;
      }>;
    };

    return parseLlmExtractedFields(parsed.fields ?? []);
  } catch (error) {
    console.warn("LLM field extraction fallback failed:", error);
    return [];
  }
}
