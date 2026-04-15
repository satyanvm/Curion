import {
  ExtractionConfidenceReport,
  FieldMappingConfidence,
  FormField,
  MappingCandidateScore,
  MappingConfidenceReport,
  MappingMethod,
  UserProfile,
} from "../types/types";

export type MappingDecisionInput = {
  label: string;
  selector: string;
  method: Exclude<MappingMethod, "unmapped">;
  mappedKey: keyof UserProfile;
  mappedValue: string;
  baseScore: number;
  candidateScores: MappingCandidateScore[];
  reasons: string[];
  weaknesses: string[];
};

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function getExtractionScore(
  field: FormField,
  extractionReport?: ExtractionConfidenceReport
): number {
  return (
    extractionReport?.fieldReports.find((report) => report.selector === field.selector)?.score ?? 0.75
  );
}

export function buildMappingConfidenceReport(
  fields: FormField[],
  decisions: Map<string, MappingDecisionInput>,
  extractionReport?: ExtractionConfidenceReport
): MappingConfidenceReport {
  const fieldReports: FieldMappingConfidence[] = fields.map((field) => {
    const extractionScore = getExtractionScore(field, extractionReport);
    const decision = decisions.get(field.label);

    if (!decision) {
      return {
        label: field.label,
        selector: field.selector,
        score: clamp(0.25 + extractionScore * 0.2),
        extractionScore,
        method: "unmapped",
        reasons: [],
        weaknesses: ["No confident deterministic mapping was found"],
        candidateScores: [],
        shouldUseLLM: true,
      };
    }

    const score = clamp(decision.baseScore * 0.72 + extractionScore * 0.28);
    const shouldUseLLM = score < 0.75;

    return {
      label: field.label,
      selector: field.selector,
      score,
      extractionScore,
      method: decision.method,
      mappedKey: decision.mappedKey,
      mappedValue: decision.mappedValue,
      reasons: decision.reasons,
      weaknesses: decision.weaknesses,
      candidateScores: decision.candidateScores,
      shouldUseLLM,
    };
  });

  const overallScore = clamp(
    fieldReports.reduce((sum, report) => sum + report.score, 0) / Math.max(fieldReports.length, 1)
  );
  const unresolvedCount = fieldReports.filter((report) => report.method === "unmapped").length;
  const lowConfidenceCount = fieldReports.filter((report) => report.shouldUseLLM).length;

  const reasons: string[] = [];
  if (overallScore < 0.76) reasons.push("Average mapping confidence is below the trust threshold");
  if (unresolvedCount > 0) reasons.push("Some fields remain unresolved");
  if (lowConfidenceCount / Math.max(fieldReports.length, 1) >= 0.3) {
    reasons.push("A large portion of fields have weak mapping confidence");
  }

  return {
    overallScore,
    shouldUseLLM:
      unresolvedCount > 0 ||
      overallScore < 0.76 ||
      lowConfidenceCount / Math.max(fieldReports.length, 1) >= 0.3,
    reasons,
    fieldReports,
    unresolvedCount,
  };
}
