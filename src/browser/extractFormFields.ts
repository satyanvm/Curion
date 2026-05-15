import { Page } from "playwright";
import { extractFields } from "./extractFields";
import { calculateExtractionConfidence } from "../confidence/extractionConfidence";
import { calculateHtmlAdequacy } from "../confidence/htmlAdequacy";
import { extractFieldsWithLLM } from "../llm/extractFieldsWithLLM";
import { ExtractionConfidenceReport, FormField, HtmlAdequacyReport } from "../types/types";

export interface ExtractedFieldSet {
  fields: FormField[];
  extractionSource: "dom" | "dom+llm" | "dom-needs-vision" | "dom+llm-deferred";
  report: ExtractionConfidenceReport;
  htmlAdequacyReport: HtmlAdequacyReport;
  /** When true, extraction LLM was skipped so mapping can run one unified LLM call. */
  deferredLlmExtraction: boolean;
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

function shouldDeferLlmExtraction(
  domReport: ExtractionConfidenceReport,
  htmlAdequacyReport: HtmlAdequacyReport
): boolean {
  if (!domReport.shouldUseLLM) {
    return false;
  }

  if (htmlAdequacyReport.recommendedFallback === "vision") {
    return false;
  }

  if (htmlAdequacyReport.recommendedFallback === "dom-repair") {
    return false;
  }

  return htmlAdequacyReport.recommendedFallback === "llm-html";
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
      deferredLlmExtraction: false,
    };
  }

  if (htmlAdequacyReport.recommendedFallback === "vision") {
    return {
      fields: domFields,
      extractionSource: "dom-needs-vision",
      report: domReport,
      htmlAdequacyReport,
      deferredLlmExtraction: false,
    };
  }

  if (htmlAdequacyReport.recommendedFallback === "dom-repair") {
    return {
      fields: domFields,
      extractionSource: "dom",
      report: domReport,
      htmlAdequacyReport,
      deferredLlmExtraction: false,
    };
  }

  if (shouldDeferLlmExtraction(domReport, htmlAdequacyReport)) {
    return {
      fields: domFields,
      extractionSource: "dom+llm-deferred",
      report: domReport,
      htmlAdequacyReport,
      deferredLlmExtraction: true,
    };
  }

  const llmFields = await extractFieldsWithLLM(page);
  if (llmFields.length === 0) {
    return {
      fields: domFields,
      extractionSource: "dom",
      report: domReport,
      htmlAdequacyReport,
      deferredLlmExtraction: false,
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
    deferredLlmExtraction: false,
  };
}
