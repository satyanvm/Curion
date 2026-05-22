import { Page } from "playwright";
import {
  ExtractionConfidenceReport,
  FieldValueMap,
  FormField,
  MappingConfidenceReport,
  UserProfile,
} from "../types/types";
import { mapFieldsWithBackend } from "../backend/mapForm";

export type MapFieldsOptions = {
  formContext?: string;
  page?: Page;
  deferredLlmExtraction?: boolean;
};

export type MapFieldsResult = {
  mappedValues: FieldValueMap;
  report: MappingConfidenceReport;
  fields: FormField[];
};

export async function mapFields(
  fields: FormField[],
  userProfile: UserProfile,
  extractionReport?: ExtractionConfidenceReport,
  options?: MapFieldsOptions
): Promise<FieldValueMap> {
  const result = await mapFieldsWithConfidence(fields, userProfile, extractionReport, options);
  return result.mappedValues;
}

export async function mapFieldsWithConfidence(
  fields: FormField[],
  userProfile: UserProfile,
  _extractionReport?: ExtractionConfidenceReport,
  options?: MapFieldsOptions
): Promise<MapFieldsResult> {
  const { formContext, page } = options ?? {};
  const [url, title, html] = page
    ? await Promise.all([
        Promise.resolve(page.url()),
        page.title().catch(() => ""),
        page.content(),
      ])
    : [undefined, undefined, undefined];

  const backendResult = await mapFieldsWithBackend({
    fields,
    profile: userProfile,
    goal: formContext
      ? `Fill this page with the ${formContext}.`
      : "Fill this page with the active Curion metadata.",
    url,
    title,
    html,
  });

  const report =
    (backendResult.analysis.mappingReport as MappingConfidenceReport | undefined) ??
    ({
      overallScore: backendResult.analysis.overallConfidence ?? 0,
      shouldUseLLM: Boolean(backendResult.analysis.reviewRequired),
      reasons: backendResult.analysis.warnings ?? [],
      fieldReports: [],
      unresolvedCount: 0,
    } satisfies MappingConfidenceReport);

  return {
    mappedValues: backendResult.mappedValues,
    report,
    fields,
  };
}
