import { FieldValueMap, FormField, UserProfile } from "../types/types";
import { ExtractionConfidenceReport, MappingConfidenceReport } from "../types/types";

export type BackendFormMapping = {
  field: FormField;
  mapping: {
    key: string;
    semanticPath: string;
    value: string;
    confidence: number;
    method: string;
    reasons: string[];
    reviewRequired: boolean;
  } | null;
  candidates: Array<{
    semanticPath: string;
    confidence: number;
    distance: number;
  }>;
};

export type BackendMapFormResponse = {
  source?: string;
  fieldCount?: number;
  mappedCount?: number;
  overallConfidence?: number;
  reviewRequired?: boolean;
  warnings?: string[];
  mappingReport?: MappingConfidenceReport;
  extractionReport?: ExtractionConfidenceReport;
  mappings?: BackendFormMapping[];
};

export type BackendMapFormInput = {
  fields: FormField[];
  profile: UserProfile;
  goal?: string;
  url?: string;
  title?: string;
  html?: string;
  userId?: string;
};

export type BackendMapFormResult = {
  mappedValues: FieldValueMap;
  analysis: BackendMapFormResponse;
};

const DEFAULT_BACKEND_URL = "https://backend-three-mu-84.vercel.app/api/agent/map-form";

function backendApiUrl(): string {
  return process.env.CURION_BACKEND_API_URL || DEFAULT_BACKEND_URL;
}

export async function mapFieldsWithBackend(input: BackendMapFormInput): Promise<BackendMapFormResult> {
  const endpoint = backendApiUrl();
  const response = await globalThis.fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      goal: input.goal || "Fill this page with the active Curion metadata.",
      fields: input.fields,
      profile: input.profile,
      url: input.url,
      title: input.title,
      html: input.html,
      userId: input.userId,
    }),
  });

  if (!response.ok) {
    throw new Error(`Backend mapping failed with status ${response.status}`);
  }

  const analysis = (await response.json()) as BackendMapFormResponse;
  const mappedValues: FieldValueMap = {};

  for (const entry of analysis.mappings || []) {
    if (!entry.mapping?.value) continue;
    mappedValues[entry.field.label] = entry.mapping.value;
  }

  return { mappedValues, analysis };
}
