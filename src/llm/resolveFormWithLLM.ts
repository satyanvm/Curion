import { Page } from "playwright";
import {
  ExtractionConfidenceReport,
  FieldValueMap,
  FormField,
  MappingConfidenceReport,
  UserProfile,
} from "../types/types";
import { MappingDecisionInput } from "../confidence/mappingConfidence";
import { parseLlmExtractedFields } from "./fieldParsing";
import { generateJsonWithGemini, isGeminiConfigured } from "./gemini";
import {
  PROFILE_SCHEMA,
  buildAvailableProfileOptions,
  buildMappedAnchors,
} from "./mappingContext";

const HTML_SNIPPET_LIMIT = 25000;

export type ResolveFormWithLLMInput = {
  page: Page;
  fields: FormField[];
  ambiguousFields: FormField[];
  userProfile: UserProfile;
  decisions: Map<string, MappingDecisionInput>;
  mappingReport: MappingConfidenceReport;
  extractionReport?: ExtractionConfidenceReport;
  formContext?: string;
};

export type ResolveFormWithLLMResult = {
  fields: FormField[];
  mappings: FieldValueMap;
};

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

function applyFieldRepairs(primary: FormField[], repairs: FormField[]): FormField[] {
  const bySelector = new Map(primary.map((field) => [field.selector, field]));

  for (const repair of repairs) {
    const existing = bySelector.get(repair.selector);
    if (existing) {
      bySelector.set(repair.selector, {
        ...existing,
        ...repair,
        labelSource: repair.labelSource ?? existing.labelSource,
      });
      continue;
    }

    bySelector.set(repair.selector, repair);
  }

  return Array.from(bySelector.values());
}

function buildTargetFieldContext(
  targetFields: FormField[],
  decisions: Map<string, MappingDecisionInput>,
  mappingReport: MappingConfidenceReport
): Array<{
  field: FormField;
  status: "low-confidence" | "unmapped";
  currentMapping?: {
    mappedKey: MappingDecisionInput["mappedKey"];
    mappedValue: string;
    method: MappingDecisionInput["method"];
    score: number;
    reasons: string[];
    weaknesses: string[];
  };
  confidence?: MappingConfidenceReport["fieldReports"][number];
}> {
  return targetFields.map((field) => {
    const decision = decisions.get(field.label);
    const confidence = mappingReport.fieldReports.find(
      (fieldReport) => fieldReport.label === field.label
    );

    return {
      field,
      status: decision ? "low-confidence" : "unmapped",
      currentMapping: decision
        ? {
            mappedKey: decision.mappedKey,
            mappedValue: decision.mappedValue,
            method: decision.method,
            score: decision.baseScore,
            reasons: decision.reasons,
            weaknesses: decision.weaknesses,
          }
        : undefined,
      confidence,
    };
  });
}

export async function resolveFormWithLLM(
  input: ResolveFormWithLLMInput
): Promise<ResolveFormWithLLMResult | null> {
  if (!isGeminiConfigured()) {
    return null;
  }

  const {
    page,
    fields,
    ambiguousFields,
    userProfile,
    decisions,
    mappingReport,
    extractionReport,
    formContext,
  } = input;

  if (ambiguousFields.length === 0) {
    return null;
  }

  const html = await page.content();
  const htmlSnippet = html.slice(0, HTML_SNIPPET_LIMIT);
  const targetFieldContext = buildTargetFieldContext(ambiguousFields, decisions, mappingReport);

  try {
    const content = await generateJsonWithGemini(
      [
        "You resolve a partially understood HTML form in one rich pass.",
        "Tasks:",
        "1) Repair or add fillable fields when DOM extraction is weak (fix labels, add missing inputs/selects/textareas).",
        "2) Map every low-confidence or unmapped target field to the best profile value.",
        "Use form HTML, field metadata, confidence reports, existing low-confidence guesses, already-mapped anchors, and profile schema.",
        "Treat already-mapped anchors as context for the form's pattern, but correct low-confidence guesses when the context points elsewhere.",
        "Prefer unused profile keys unless the form clearly repeats the same information or the target field's current mapping is genuinely correct.",
        "For select/checkbox fields, return values that match visible options when provided.",
        "Never map an email-looking field to a non-email profile value. If the email value is missing, leave that field unmapped.",
        "Return strict JSON with:",
        "- fieldRepairs: array of { label, selector, type, name?, placeholder?, options? } for repaired or newly discovered fields",
        "- mappings: object keyed by exact field label with profile values for target fields only; never return profile key names like company, city, state, postalCode, notes, or acceptTerms",
        "Selectors must reference real ids or names from the HTML.",
      ].join(" "),
      {
        url: page.url(),
        html: htmlSnippet,
        formContext,
        domFields: fields,
        targetFields: targetFieldContext,
        alreadyMappedFields: buildMappedAnchors(decisions),
        alreadyMappedValues: Object.fromEntries(
          Array.from(decisions.values()).map((decision) => [decision.label, decision.mappedValue])
        ),
        availableProfileOptions: buildAvailableProfileOptions(decisions, userProfile),
        profileSchema: PROFILE_SCHEMA,
        userProfile,
        extractionConfidence: extractionReport,
        mappingConfidence: mappingReport,
      }
    );

    const parsed = JSON.parse(content) as {
      fieldRepairs?: Array<{
        label?: string;
        selector?: string;
        type?: string;
        name?: string;
        placeholder?: string;
        options?: string[];
      }>;
      mappings?: FieldValueMap;
    };

    const repairedFields = parseLlmExtractedFields(parsed.fieldRepairs ?? []);
    const mergedFields = applyFieldRepairs(mergeFields(fields, repairedFields), repairedFields);

    return {
      fields: mergedFields,
      mappings: parsed.mappings ?? {},
    };
  } catch (error) {
    console.warn("Unified form resolution failed:", error);
    return null;
  }
}
