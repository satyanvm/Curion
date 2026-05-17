import { FieldValueMap, FormField, MappingCandidateScore, UserProfile } from "../types/types";

type ProfileKey = keyof UserProfile;

type CandidateProfileField = {
  key: ProfileKey;
  value: string;
  aliases: string[];
};

type SemanticScore = {
  key: ProfileKey;
  score: number;
};

export type SemanticFieldDecision = {
  mappedKey: ProfileKey;
  mappedValue: string;
  score: number;
  candidateScores: MappingCandidateScore[];
  reasons: string[];
  weaknesses: string[];
};

const PROFILE_ALIASES: Record<ProfileKey, string[]> = {
  name: [
    "name",
    "full name",
    "your name",
    "applicant",
    "applicant name",
    "candidate",
    "candidate name",
    "legal name",
    "person name",
    "primary contact",
  ],
  email: [
    "email",
    "e mail",
    "mail",
    "work email",
    "business email",
    "contact email",
    "reply to",
    "follow up email",
  ],
  phone: [
    "phone",
    "mobile",
    "telephone",
    "contact number",
    "cell",
    "cell phone",
    "whatsapp number",
  ],
  jobTitle: ["job title", "role", "designation", "position", "current role", "title", "seat"],
  address: ["address", "street address", "address line", "residence line", "line 1", "base"],
  city: ["city", "town", "municipality", "locality", "market"],
  state: ["state", "province", "region", "province region", "territory"],
  postalCode: ["postal code", "postcode", "zip", "zip code", "pin code", "zone"],
  country: ["country", "nation", "residence", "nation of residence", "citizenship", "geo region", "geo"],
  linkedin: ["linkedin", "linkedin url", "linkedin profile", "professional profile", "profile"],
  website: ["website", "portfolio", "homepage", "personal site", "site url", "source"],
  company: ["company", "organization", "organisation", "employer", "business", "account"],
  preferredContactMethod: [
    "preferred contact",
    "contact method",
    "preferred channel",
    "reach you",
    "contact channel",
    "reach preference",
    "next touch",
  ],
  notes: ["notes", "message", "comments", "about you", "additional info", "additional notes", "context"],
  acceptTerms: ["terms", "privacy", "consent", "agree", "policy"],
};

function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function toTokens(text: string): string[] {
  return normalize(text).split(/\s+/).filter(Boolean);
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function buildProfileCandidates(userProfile: UserProfile): CandidateProfileField[] {
  return (Object.keys(userProfile) as ProfileKey[])
    .filter((key) => userProfile[key])
    .map((key) => ({
      key,
      value: userProfile[key],
      aliases: unique([key, ...PROFILE_ALIASES[key]]),
    }));
}

function buildFieldMeaning(field: FormField): string {
  return [field.label, field.name ?? "", field.placeholder ?? "", field.type, ...(field.options ?? [])]
    .join(" ")
    .trim();
}

function tokenOverlapScore(fieldTokens: string[], aliasTokens: string[]): number {
  if (fieldTokens.length === 0 || aliasTokens.length === 0) {
    return 0;
  }

  const overlapCount = aliasTokens.filter((token) => fieldTokens.includes(token)).length;
  if (overlapCount === 0) {
    return 0;
  }

  return overlapCount / aliasTokens.length;
}

function getTypeCompatibilityBoost(field: FormField, key: ProfileKey): number {
  if (field.type === "email" && key === "email") return 0.45;
  if (field.type === "tel" && key === "phone") return 0.45;
  if (field.type === "url" && (key === "linkedin" || key === "website")) return 0.35;
  if (field.type === "select" && (key === "country" || key === "preferredContactMethod")) return 0.25;
  return 0;
}

function getRequiredKeyForField(field: FormField): ProfileKey | null {
  const fieldMeaning = normalize(buildFieldMeaning(field));
  if (field.type === "email" || /(^| )(email|e mail)( |$)/.test(fieldMeaning)) return "email";
  if (field.type === "tel" || /(^| )(phone|mobile|telephone|tel)( |$)/.test(fieldMeaning)) return "phone";
  return null;
}

function isEmailValue(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function isCompatibleWithField(field: FormField, candidate: CandidateProfileField): boolean {
  const requiredKey = getRequiredKeyForField(field);
  if (!requiredKey) return true;
  if (candidate.key !== requiredKey) return false;
  if (requiredKey === "email") return isEmailValue(candidate.value);
  return true;
}

function getOptionBoost(field: FormField, candidate: CandidateProfileField): number {
  if (field.type !== "select" || !field.options?.length) {
    return 0;
  }

  const lowerOptions = field.options.map((option) => option.toLowerCase());
  if (lowerOptions.includes(candidate.value.toLowerCase())) {
    return 0.35;
  }

  return 0;
}

function scoreCandidate(field: FormField, candidate: CandidateProfileField): SemanticScore {
  if (!isCompatibleWithField(field, candidate)) {
    return {
      key: candidate.key,
      score: 0,
    };
  }

  const fieldMeaning = normalize(buildFieldMeaning(field));
  const fieldTokens = toTokens(fieldMeaning);

  let score = 0;

  for (const alias of candidate.aliases) {
    const normalizedAlias = normalize(alias);
    if (!normalizedAlias) continue;

    if (fieldMeaning === normalizedAlias) {
      score = Math.max(score, 0.95);
      continue;
    }

    if (fieldMeaning.includes(normalizedAlias)) {
      score = Math.max(score, normalizedAlias.includes(" ") ? 0.88 : 0.76);
    }

    const aliasTokens = toTokens(normalizedAlias);
    score = Math.max(score, 0.7 * tokenOverlapScore(fieldTokens, aliasTokens));
  }

  score += getTypeCompatibilityBoost(field, candidate.key);
  score += getOptionBoost(field, candidate);

  if (["placeholder", "name", "id"].includes(field.labelSource)) {
    score -= 0.03;
  }

  return {
    key: candidate.key,
    score,
  };
}

export function semanticMatchFieldsDetailed(
  fields: FormField[],
  userProfile: UserProfile,
  existingValues: FieldValueMap
): Map<string, SemanticFieldDecision> {
  const semanticValues = new Map<string, SemanticFieldDecision>();
  const candidates = buildProfileCandidates(userProfile);

  for (const field of fields) {
    if (existingValues[field.label]) {
      continue;
    }

    if (field.type === "checkbox" || field.type === "radio") {
      continue;
    }

    const ranked = candidates
      .map((candidate) => scoreCandidate(field, candidate))
      .sort((left, right) => right.score - left.score);

    const best = ranked[0];
    const runnerUp = ranked[1];

    if (!best) {
      continue;
    }

    const confidenceGap = runnerUp ? best.score - runnerUp.score : best.score;
    const confidentEnough = best.score >= 0.82;
    const separatedEnough = confidenceGap >= 0.12;
    const candidateScores = ranked.slice(0, 3).map((candidate) => ({
      key: candidate.key,
      score: Math.max(0, Math.min(1, candidate.score)),
    }));

    const reasons = [
      `Top semantic candidate is ${best.key}`,
      `Semantic score ${best.score.toFixed(2)} with confidence gap ${confidenceGap.toFixed(2)}`,
    ];
    const weaknesses: string[] = [];

    if (!confidentEnough || !separatedEnough) {
      if (!confidentEnough) weaknesses.push("Top semantic score is below threshold");
      if (!separatedEnough) weaknesses.push("Runner-up candidate is too close");
      continue;
    }

    semanticValues.set(field.label, {
      mappedKey: best.key,
      mappedValue: userProfile[best.key],
      score: Math.max(0, Math.min(1, best.score)),
      candidateScores,
      reasons,
      weaknesses,
    });
  }

  return semanticValues;
}

export function semanticMatchFields(
  fields: FormField[],
  userProfile: UserProfile,
  existingValues: FieldValueMap
): FieldValueMap {
  const detailed = semanticMatchFieldsDetailed(fields, userProfile, existingValues);
  return Object.fromEntries(
    Array.from(detailed.entries()).map(([label, decision]) => [label, decision.mappedValue])
  );
}
