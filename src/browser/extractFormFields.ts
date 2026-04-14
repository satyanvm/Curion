import { Page } from "playwright";
import { extractFields } from "./extractFields";
import { extractFieldsWithLLM } from "../llm/extractFieldsWithLLM";
import { FormField } from "../types/types";

export interface ExtractedFieldSet {
  fields: FormField[];
  extractionSource: "dom" | "dom+llm";
}

function shouldFallbackToLLM(fields: FormField[]): boolean {
  if (fields.length === 0) {
    return true;
  }

  const weakLabels = fields.filter((field) =>
    ["placeholder", "name", "id"].includes(field.labelSource)
  ).length;

  return weakLabels / fields.length >= 0.5;
}

function mergeFields(primary: FormField[], secondary: FormField[]): FormField[] {
  const merged = new Map<string, FormField>();

  for (const field of primary) {
    merged.set(field.selector, field);
  }

  for (const field of secondary) {
    if (!merged.has(field.selector)) {
      merged.set(field.selector, field);
    }
  }

  return Array.from(merged.values());
}

export async function extractFormFields(page: Page): Promise<ExtractedFieldSet> {
  const domFields = await extractFields(page);

  if (!shouldFallbackToLLM(domFields)) {
    return {
      fields: domFields,
      extractionSource: "dom",
    };
  }

  const llmFields = await extractFieldsWithLLM(page);
  if (llmFields.length === 0) {
    return {
      fields: domFields,
      extractionSource: "dom",
    };
  }

  return {
    fields: mergeFields(domFields, llmFields),
    extractionSource: "dom+llm",
  };
}
