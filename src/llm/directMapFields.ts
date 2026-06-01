import type { BackendMapFormResult } from "../backend/mapForm";
import { FieldMappingConfidence, FieldValueMap, FormField, MappingConfidenceReport, UserProfile } from "../types/types";
import { generateJsonWithOpenAI, isOpenAiConfigured } from "./openai";

type ProfileAtom = {
  semanticPath: string;
  rawValue: string;
};

type LocalMapping = {
  field: FormField;
  mapping: {
    key: string;
    semanticPath: string;
    value: string;
    confidence: number;
    method: "rule" | "llm";
    reasons: string[];
    reviewRequired: boolean;
  } | null;
  candidates: Array<{ semanticPath: string; confidence: number; distance: number }>;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function flattenProfile(profile: Record<string, unknown>, prefix = ""): ProfileAtom[] {
  const atoms: ProfileAtom[] = [];
  for (const [key, value] of Object.entries(profile)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) {
      atoms.push(...flattenProfile(value, path));
      continue;
    }
    if (Array.isArray(value)) {
      const rawValue = value.map(String).map((item) => item.trim()).filter(Boolean).join(", ");
      if (rawValue) atoms.push({ semanticPath: path, rawValue });
      continue;
    }
    if (value !== undefined && value !== null && String(value).trim()) {
      atoms.push({ semanticPath: path, rawValue: String(value).trim() });
    }
  }
  return atoms;
}

function addDerivedNameAtoms(atoms: ProfileAtom[]): ProfileAtom[] {
  const existingPaths = new Set(atoms.map((atom) => atom.semanticPath));
  const derived: ProfileAtom[] = [];

  for (const atom of atoms) {
    const leaf = atom.semanticPath.split(".").pop() || "";
    if (!/^(name|fullName|full_name)$/i.test(leaf)) continue;
    const parts = atom.rawValue.split(/\s+/).filter(Boolean);
    if (parts.length < 2) continue;

    const prefix = atom.semanticPath.includes(".")
      ? atom.semanticPath.split(".").slice(0, -1).join(".")
      : "";
    const firstNamePath = prefix ? `${prefix}.firstName` : "firstName";
    const lastNamePath = prefix ? `${prefix}.lastName` : "lastName";

    if (!existingPaths.has(firstNamePath)) derived.push({ semanticPath: firstNamePath, rawValue: parts.slice(0, -1).join(" ") });
    if (!existingPaths.has(lastNamePath)) derived.push({ semanticPath: lastNamePath, rawValue: parts[parts.length - 1] });
  }

  return [...atoms, ...derived];
}

function normalizeText(text: string | undefined): string {
  return String(text || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function fieldText(field: FormField): string {
  return normalizeText([field.label, field.name, field.placeholder, field.type].filter(Boolean).join(" "));
}

function pathMatches(atom: ProfileAtom, patterns: RegExp[]): boolean {
  const path = normalizeText(atom.semanticPath);
  return patterns.some((pattern) => pattern.test(path));
}

function valueMatchesOptions(field: FormField, atom: ProfileAtom): boolean {
  if (!field.options?.length) return true;
  const value = normalizeText(atom.rawValue);
  return field.options.some((option) => normalizeText(option) === value);
}

function exactRuleAtom(field: FormField, atoms: ProfileAtom[]): { atom: ProfileAtom; confidence: number; reason: string } | null {
  const text = fieldText(field);
  const rules: Array<{ test: RegExp; pathPatterns: RegExp[]; confidence: number; reason: string }> = [
    { test: /\b(email|e mail|inbox)\b/, pathPatterns: [/\bemail\b/], confidence: 0.96, reason: "Email field matched by type/label" },
    { test: /\b(phone|mobile|telephone|tel|line)\b/, pathPatterns: [/\bphone\b/, /\bmobile\b/, /\btel\b/], confidence: 0.95, reason: "Phone field matched by type/label" },
    { test: /\b(company|organization|organisation|employer|business)\b/, pathPatterns: [/\bcompany\b/, /\borganization\b/], confidence: 0.93, reason: "Company field matched by label" },
    { test: /\b(job title|current seat|seat|role|position|designation|title)\b/, pathPatterns: [/\bjob title\b/, /\btitle\b/, /\brole\b/, /\bposition\b/], confidence: 0.92, reason: "Job title field matched by label" },
    { test: /\b(full name|your name|applicant name|primary contact|contact name|name)\b/, pathPatterns: [/\bname\b/], confidence: 0.92, reason: "Name field matched by label" },
    { test: /\b(address|street|address line)\b/, pathPatterns: [/\baddress\b/, /\bstreet\b/], confidence: 0.91, reason: "Address field matched by label" },
    { test: /\b(city|market|town|locality)\b/, pathPatterns: [/\bcity\b/], confidence: 0.9, reason: "City field matched by label" },
    { test: /\b(state|province|territory|region)\b/, pathPatterns: [/\bstate\b/], confidence: 0.9, reason: "State field matched by label" },
    { test: /\b(postal|zip|postcode|pin code|zone)\b/, pathPatterns: [/\bpostal code\b/], confidence: 0.9, reason: "Postal code field matched by label" },
    { test: /\b(country|nation|geo)\b/, pathPatterns: [/\bcountry\b/], confidence: 0.9, reason: "Country field matched by label" },
    { test: /\b(linkedin|profile)\b/, pathPatterns: [/\blinkedin\b/], confidence: 0.91, reason: "LinkedIn field matched by label" },
    { test: /\b(website|site|source url|source|url|homepage)\b/, pathPatterns: [/\bwebsite\b/], confidence: 0.88, reason: "Website field matched by label" },
    { test: /\b(preferred contact|contact method|next touch|channel)\b/, pathPatterns: [/\bpreferred contact method\b/], confidence: 0.9, reason: "Preferred contact method field matched by label" },
    { test: /\b(notes|message|comments|context|memo|about)\b/, pathPatterns: [/\bnotes\b/], confidence: 0.9, reason: "Notes field matched by label" },
    { test: /\b(terms|privacy|agree|consent|ok to proceed)\b/, pathPatterns: [/\baccept terms\b/], confidence: 0.93, reason: "Consent field matched by label" },
  ];

  for (const rule of rules) {
    if (!rule.test.test(text)) continue;
    const atom = atoms.find((candidate) => pathMatches(candidate, rule.pathPatterns) && valueMatchesOptions(field, candidate));
    if (atom) return { atom, confidence: rule.confidence, reason: rule.reason };
  }

  return null;
}

function buildRuleMappings(fields: FormField[], atoms: ProfileAtom[]): LocalMapping[] {
  return fields.map((field) => {
    const match = exactRuleAtom(field, atoms);
    if (!match) return { field, mapping: null, candidates: [] };

    return {
      field,
      mapping: {
        key: match.atom.semanticPath,
        semanticPath: match.atom.semanticPath,
        value: match.atom.rawValue,
        confidence: match.confidence,
        method: "rule",
        reasons: [match.reason],
        reviewRequired: match.confidence < 0.86,
      },
      candidates: [{ semanticPath: match.atom.semanticPath, confidence: match.confidence, distance: 1 - match.confidence }],
    };
  });
}

function buildMappingReport(fields: FormField[], mappings: LocalMapping[]): MappingConfidenceReport {
  const fieldReports = fields.map((field) => {
    const entry = mappings.find((mapping) => mapping.field.label === field.label);
    const mapped = entry?.mapping;
    return {
      label: field.label,
      selector: field.selector,
      score: mapped ? mapped.confidence : 0.25,
      extractionScore: 0.78,
      method: mapped ? mapped.method : "unmapped" as const,
      mappedKey: mapped?.key,
      mappedValue: mapped?.value,
      reasons: mapped?.reasons || [],
      weaknesses: mapped ? [] : ["No confident local rule or LLM mapping was found"],
      candidateScores: mapped ? [{ key: mapped.key, score: mapped.confidence }] : [],
      shouldUseLLM: !mapped || mapped.method === "llm" || mapped.reviewRequired,
    } as FieldMappingConfidence;
  });

  const mappedCount = fieldReports.filter((report) => report.method !== "unmapped").length;
  const overallScore =
    fieldReports.reduce((sum, report) => sum + report.score, 0) / Math.max(fieldReports.length, 1);

  return {
    overallScore,
    shouldUseLLM: fieldReports.some((report) => report.shouldUseLLM),
    reasons: fieldReports.some((report) => report.method === "llm")
      ? ["LLM fallback was used for at least one field"]
      : ["Local deterministic rules mapped the form"],
    fieldReports,
    unresolvedCount: fieldReports.length - mappedCount,
  };
}

export async function mapFieldsDirectlyWithLlm(input: {
  fields: FormField[];
  profile: UserProfile;
  goal?: string;
  url?: string;
  title?: string;
  html?: string;
  llmApiKey?: string;
}): Promise<BackendMapFormResult> {
  if (!isOpenAiConfigured(input.llmApiKey)) {
    throw new Error("OpenAI API key is required for local LLM mapping");
  }

  const atoms = addDerivedNameAtoms(flattenProfile(input.profile as unknown as Record<string, unknown>));
  let mappings = buildRuleMappings(input.fields, atoms);
  const unresolvedFields = mappings.filter((entry) => !entry.mapping).map((entry) => entry.field);

  if (unresolvedFields.length === 0) {
    const mappedValues: FieldValueMap = {};
    for (const entry of mappings) {
      if (entry.mapping) mappedValues[entry.field.label] = entry.mapping.value;
    }
    const mappingReport = buildMappingReport(input.fields, mappings);
    return {
      mappedValues,
      analysis: {
        source: "local-rule",
        fieldCount: input.fields.length,
        mappedCount: Object.keys(mappedValues).length,
        overallConfidence: mappingReport.overallScore,
        reviewRequired: mappingReport.unresolvedCount > 0,
        warnings: [],
        mappingReport,
        mappings,
      },
    };
  }

  const content = await generateJsonWithOpenAI(
    [
      "Map web form fields to the exact reusable profile values.",
      "Return strict JSON where each key is an exact field label from fields and each value is an exact semanticPath from profileAtoms.",
      "Only use semanticPath values from profileAtoms. Skip fields that do not clearly match.",
      "For select and radio fields, choose the profile atom whose rawValue matches an available option when possible.",
      "Never invent values."
    ].join(" "),
    {
      goal: input.goal || "Fill this form with the active profile.",
      url: input.url || "",
      title: input.title || "",
      htmlSnippet: input.html ? input.html.slice(0, 12000) : "",
      fields: unresolvedFields,
      alreadyMappedFields: mappings
        .filter((entry) => entry.mapping)
        .map((entry) => ({
          label: entry.field.label,
          semanticPath: entry.mapping?.semanticPath,
          value: entry.mapping?.value,
          method: entry.mapping?.method,
        })),
      profileAtoms: atoms,
    },
    { apiKey: input.llmApiKey }
  );

  const parsed = JSON.parse(content) as Record<string, string>;
  const byPath = new Map(atoms.map((atom) => [atom.semanticPath, atom]));
  const mappedValues: FieldValueMap = {};
  mappings = mappings.map((existing) => {
    if (existing.mapping) return existing;
    const field = existing.field;
    const path = parsed[field.label];
    const atom = path ? byPath.get(path) : undefined;
    if (!atom) {
      return { field, mapping: null, candidates: [] };
    }
    mappedValues[field.label] = atom.rawValue;
    return {
      field,
      mapping: {
        key: atom.semanticPath,
        semanticPath: atom.semanticPath,
        value: atom.rawValue,
        confidence: 0.78,
        method: "llm",
        reasons: ["OpenAI local LLM mapping selected the profile atom"],
        reviewRequired: false,
      },
      candidates: [{ semanticPath: atom.semanticPath, confidence: 0.78, distance: 0.22 }],
    };
  });
  for (const entry of mappings) {
    if (entry.mapping) mappedValues[entry.field.label] = entry.mapping.value;
  }
  const mappingReport = buildMappingReport(input.fields, mappings);

  return {
    mappedValues,
    analysis: {
      source: mappings.some((entry) => entry.mapping?.method === "llm") ? "local-rule+openai-llm" : "local-rule",
      fieldCount: input.fields.length,
      mappedCount: Object.keys(mappedValues).length,
      overallConfidence: mappingReport.overallScore,
      reviewRequired: mappingReport.unresolvedCount > 0,
      warnings: [],
      mappingReport,
      mappings,
    },
  };
}
