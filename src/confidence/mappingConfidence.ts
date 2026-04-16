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
): { score: number; missing: boolean } {
  const matchedReport = extractionReport?.fieldReports.find(
    (report) => report.selector === field.selector
  );

  if (!matchedReport) {
    return {
      score: 0,
      missing: true,
    };
  }

  return {
    score: matchedReport.score,
    missing: false,
  };
}

export function buildMappingConfidenceReport(
  fields: FormField[],
  decisions: Map<string, MappingDecisionInput>,
  extractionReport?: ExtractionConfidenceReport
): MappingConfidenceReport {
  const fieldReports: FieldMappingConfidence[] = fields.map((field) => {
    const extractionResult = getExtractionScore(field, extractionReport);
    const extractionScore = extractionResult.score;
    const decision = decisions.get(field.label);

    if (!decision) {
      const weaknesses = ["No confident deterministic mapping was found"];
      if (extractionResult.missing) {
        weaknesses.push("Missing extraction confidence report");
      }

      return {
        label: field.label,
        selector: field.selector,
        score: clamp(0.25 + extractionScore * 0.2),
        extractionScore,
        method: "unmapped",
        reasons: [],
        weaknesses,
        candidateScores: [],
        shouldUseLLM: true,
      };
    }

    const score = clamp(decision.baseScore * 0.72 + extractionScore * 0.28);
    const weaknesses = [...decision.weaknesses];
    if (extractionResult.missing) {
      weaknesses.push("Missing extraction confidence report");
    }
    const shouldUseLLM = score < 0.75 || extractionResult.missing;

    return {
      label: field.label,
      selector: field.selector,
      score,
      extractionScore,
      method: decision.method,
      mappedKey: decision.mappedKey,
      mappedValue: decision.mappedValue,
      reasons: decision.reasons,
      weaknesses,
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
