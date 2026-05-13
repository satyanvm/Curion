import { Page } from "playwright";
import { extractFields } from "./extractFields";
import { calculateExtractionConfidence } from "../confidence/extractionConfidence";
import { calculateHtmlAdequacy } from "../confidence/htmlAdequacy";
import { extractFieldsWithLLM } from "../llm/extractFieldsWithLLM";
import { ExtractionConfidenceReport, FormField, HtmlAdequacyReport } from "../types/types";

export interface ExtractedFieldSet {
  fields: FormField[];
  extractionSource: "dom" | "dom+llm" | "dom-needs-vision";
  report: ExtractionConfidenceReport;
  htmlAdequacyReport: HtmlAdequacyReport;
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
  const htmlAdequacyReport = await calculateHtmlAdequacy(page, domFields, domReport);

  if (!domReport.shouldUseLLM) {
    return {
      fields: domFields,
      extractionSource: "dom",
      report: domReport,
      htmlAdequacyReport,
    };
  }

  if (htmlAdequacyReport.recommendedFallback === "vision") {
    return {
      fields: domFields,
      extractionSource: "dom-needs-vision",
      report: domReport,
      htmlAdequacyReport,
    };
  }

  if (htmlAdequacyReport.recommendedFallback === "dom-repair") {
    return {
      fields: domFields,
      extractionSource: "dom",
      report: domReport,
      htmlAdequacyReport,
    };
  }

  const llmFields = await extractFieldsWithLLM(page);
  if (llmFields.length === 0) {
    return {
      fields: domFields,
      extractionSource: "dom",
      report: domReport,
      htmlAdequacyReport,
    };
  }

  const mergedFields = mergeFields(domFields, llmFields);
  const mergedReport = calculateExtractionConfidence(mergedFields);
  const mergedAdequacyReport = await calculateHtmlAdequacy(page, mergedFields, mergedReport);

  return {
    fields: mergedFields,
    extractionSource: "dom+llm",
    report: mergedReport,
    htmlAdequacyReport: mergedAdequacyReport,
  };
}
