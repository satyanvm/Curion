import { Page } from "playwright";
import { extractFields } from "./extractFields";
import { calculateExtractionConfidence } from "../confidence/extractionConfidence";
import { extractFieldsWithLLM } from "../llm/extractFieldsWithLLM";
import { ExtractionConfidenceReport, FormField } from "../types/types";

export interface ExtractedFieldSet {
  fields: FormField[];
  extractionSource: "dom" | "dom+llm";
  report: ExtractionConfidenceReport;
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
  const domReport = calculateExtractionConfidence(domFields);

  if (!domReport.shouldUseLLM) {
    return {
      fields: domFields,
      extractionSource: "dom",
      report: domReport,
    };
  }

  const llmFields = await extractFieldsWithLLM(page);
  if (llmFields.length === 0) {
    return {
      fields: domFields,
      extractionSource: "dom",
      report: domReport,
    };
  }

  const mergedFields = mergeFields(domFields, llmFields);
  const mergedReport = calculateExtractionConfidence(mergedFields);

  return {
    fields: mergedFields,
    extractionSource: "dom+llm",
    report: mergedReport,
  };
}
