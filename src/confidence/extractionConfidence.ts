import { ExtractionConfidenceReport, ExtractionFieldConfidence, FormField } from "../types/types";

function clamp(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function isReadableText(text: string | undefined): boolean {
  if (!text) return false;
  return /^[a-z0-9][a-z0-9\s/()_-]{2,}$/i.test(text) && !/(ctl\d+|field[_-]?\d+|input[_-]?\d+)/i.test(text);
}

function getLabelSourceScore(field: FormField): number {
  switch (field.labelSource) {
    case "label":
    case "aria-label":
    case "aria-labelledby":
      return 0.95;
    case "parent-label":
      return 0.82;
    case "placeholder":
      return 0.62;
    case "name":
      return 0.5;
    case "id":
      return 0.38;
    case "llm":
      return 0.88;
  }
}

function getSelectorScore(selector: string): number {
  if (selector.startsWith("#")) return 0.95;
  if (/\[name=/.test(selector)) return 0.82;
  if (/\[data-testid=/.test(selector)) return 0.78;
  if (/\[placeholder=/.test(selector)) return 0.62;
  if (selector.includes(" > ")) return 0.42;
  return 0.55;
}

function getTypeScore(field: FormField): number {
  if (["email", "tel", "url", "select", "textarea", "checkbox", "radio"].includes(field.type)) {
    return 0.9;
  }
  if (field.type === "text") return 0.72;
  return 0.45;
}

function computeFieldConfidence(field: FormField): ExtractionFieldConfidence {
  const reasons: string[] = [];
  const weaknesses: string[] = [];

  let score = 0;

  const labelSourceScore = getLabelSourceScore(field);
  score += labelSourceScore * 0.35;
  if (labelSourceScore >= 0.82) {
    reasons.push(`Strong label source: ${field.labelSource}`);
  } else {
    weaknesses.push(`Weak label source: ${field.labelSource}`);
  }

  const readableLabel = isReadableText(field.label);
  score += (readableLabel ? 0.9 : 0.35) * 0.2;
  if (readableLabel) {
    reasons.push("Label looks human-readable");
  } else {
    weaknesses.push("Label looks machine-generated or unclear");
  }

  const selectorScore = getSelectorScore(field.selector);
  score += selectorScore * 0.2;
  if (selectorScore >= 0.8) {
    reasons.push("Selector looks stable");
  } else {
    weaknesses.push("Selector may be brittle");
  }

  const typeScore = getTypeScore(field);
  score += typeScore * 0.15;
  if (typeScore >= 0.85) {
    reasons.push(`Specific field type detected: ${field.type}`);
  } else if (field.type === "unknown") {
    weaknesses.push("Field type is unknown");
  }

  const metadataConsistency =
    [field.label, field.name, field.placeholder]
      .filter(Boolean)
      .map((value) => value!.toLowerCase())
      .some((value) => field.label.toLowerCase().includes(value) || value.includes(field.label.toLowerCase()));
  score += (metadataConsistency ? 0.8 : 0.45) * 0.1;
  if (metadataConsistency) {
    reasons.push("Field metadata is internally consistent");
  } else {
    weaknesses.push("Label/name/placeholder are not strongly aligned");
  }

  if (field.type === "select") {
    if ((field.options?.length ?? 0) >= 2) {
      score += 0.06;
      reasons.push("Dropdown options provide extra context");
    } else {
      weaknesses.push("Dropdown has limited option context");
    }
  }

  const finalScore = clamp(score);

  let recommendedAction: ExtractionFieldConfidence["recommendedAction"] = "trust";
  if (finalScore < 0.55) {
    recommendedAction = "repair-with-llm";
  } else if (finalScore < 0.72) {
    recommendedAction = "review";
  }

  return {
    selector: field.selector,
    label: field.label,
    score: finalScore,
    reasons,
    weaknesses,
    recommendedAction,
  };
}

export function calculateExtractionConfidence(fields: FormField[]): ExtractionConfidenceReport {
  if (fields.length === 0) {
    return {
      overallScore: 0,
      shouldUseLLM: true,
      reasons: ["No fields were extracted from the DOM"],
      fieldReports: [],
      weakFieldRatio: 1,
    };
  }

  const fieldReports = fields.map(computeFieldConfidence);
  const overallScore = clamp(
    fieldReports.reduce((sum, report) => sum + report.score, 0) / fieldReports.length
  );
  const weakFieldCount = fieldReports.filter((report) => report.score < 0.6).length;
  const weakFieldRatio = weakFieldCount / fieldReports.length;
  const repairCount = fieldReports.filter((report) => report.recommendedAction === "repair-with-llm").length;

  const reasons: string[] = [];
  if (overallScore < 0.68) reasons.push("Average extraction confidence is low");
  if (weakFieldRatio >= 0.35) reasons.push("Too many fields have weak extraction confidence");
  if (repairCount >= 2) reasons.push("Multiple fields need extraction repair");

  return {
    overallScore,
    shouldUseLLM: overallScore < 0.68 || weakFieldRatio >= 0.35 || repairCount >= 2,
    reasons,
    fieldReports,
    weakFieldRatio,
  };
}
