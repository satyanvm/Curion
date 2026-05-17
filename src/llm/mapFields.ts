import { Page } from "playwright";
import {
  ExtractionConfidenceReport,
  FieldValueMap,
  FormField,
  MappingCandidateScore,
  MappingConfidenceReport,
  UserProfile,
} from "../types/types";
import { buildMappingConfidenceReport, MappingDecisionInput } from "../confidence/mappingConfidence";
import { generateJsonWithGemini, isGeminiConfigured } from "./gemini";
import {
  PROFILE_SCHEMA,
  buildAvailableProfileOptions,
  buildMappedAnchors,
} from "./mappingContext";
import { resolveFormWithLLM } from "./resolveFormWithLLM";
import { semanticMatchFieldsDetailed } from "../semantic/semanticMatch";

function normalize(text: string): string {
  return text
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

type RuleFieldDecision = {
  mappedKey: keyof UserProfile;
  mappedValue: string;
  score: number;
  reasons: string[];
  weaknesses: string[];
};

function fieldMeaning(field: FormField): string {
  return normalize([field.label, field.name ?? "", field.placeholder ?? "", field.type].join(" "));
}

function getRequiredKeyForField(field: FormField): keyof UserProfile | null {
  const meaning = fieldMeaning(field);
  if (field.type === "email" || /(^| )(email|e mail)( |$)/.test(meaning)) return "email";
  if (field.type === "tel" || /(^| )(phone|mobile|telephone|tel)( |$)/.test(meaning)) return "phone";
  return null;
}

function isEmailValue(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function mappingCompatibleWithField(field: FormField, mappedKey: keyof UserProfile, mappedValue: string): boolean {
  const requiredKey = getRequiredKeyForField(field);
  if (!requiredKey) return true;
  if (mappedKey !== requiredKey) return false;
  if (requiredKey === "email") return isEmailValue(mappedValue);
  return true;
}

function ruleBasedMap(fields: FormField[], userProfile: UserProfile): Map<string, RuleFieldDecision> {
  const values = new Map<string, RuleFieldDecision>();

  for (const field of fields) {
    const semanticHint = normalize([field.label, field.name ?? ""].join(" "));
    const fallbackHint = normalize(field.placeholder ?? "");
    const haystack = `${semanticHint} ${fallbackHint}`.trim();

    if (!haystack) continue;

    const assign = (
      mappedKey: keyof UserProfile,
      score: number,
      reasons: string[],
      weaknesses: string[] = []
    ): void => {
      if (!userProfile[mappedKey]) return;
      values.set(field.label, {
        mappedKey,
        mappedValue: userProfile[mappedKey],
        score,
        reasons,
        weaknesses,
      });
    };

    if (/(e mail|email|mail|follow up|reply to|contact email)/.test(semanticHint) || field.type === "email") {
      assign("email", 0.96, ["Rule matched email semantics or email field type"]);
      continue;
    }

    if (/(phone|mobile|telephone|tel|contact number|cell|whatsapp number|direct phone)/.test(semanticHint) || field.type === "tel") {
      assign("phone", 0.96, ["Rule matched phone semantics or tel field type"]);
      continue;
    }

    if (/(full name|your name|person name|applicant name|applicant|candidate name|legal name|lead name|contact name|prospect name)/.test(semanticHint)) {
      assign("name", 0.93, ["Rule matched name semantics"]);
      continue;
    }

    if (/(job title|role|designation|position|lead title)/.test(semanticHint)) {
      assign("jobTitle", 0.93, ["Rule matched job-title semantics"]);
      continue;
    }

    if (semanticHint === "seat" || field.name === "seat") {
      assign("jobTitle", 0.9, ["Rule matched seat as job title"]);
      continue;
    }

    if (semanticHint === "base" || field.name === "base") {
      assign("address", 0.9, ["Rule matched base as street address"]);
      continue;
    }

    if (/(linkedin)/.test(semanticHint)) {
      assign("linkedin", 0.95, ["Rule matched LinkedIn semantics"]);
      continue;
    }

    if (/(website|portfolio|homepage|site url)/.test(semanticHint)) {
      assign("website", 0.92, ["Rule matched website/portfolio semantics"]);
      continue;
    }

    if (/(company|organization|organisation|employer|account company|account name)/.test(semanticHint)) {
      assign("company", 0.93, ["Rule matched company semantics"]);
      continue;
    }

    if (/(street address|address line|address)/.test(semanticHint)) {
      assign("address", 0.9, ["Rule matched address semantics"]);
      continue;
    }

    if (/(city|town)/.test(semanticHint)) {
      assign("city", 0.9, ["Rule matched city semantics"]);
      continue;
    }

    if (/(state|province|region)/.test(semanticHint)) {
      assign("state", 0.9, ["Rule matched state/province semantics"]);
      continue;
    }

    if (/(zip|postal code|postcode|pin code)/.test(semanticHint)) {
      assign("postalCode", 0.92, ["Rule matched postal-code semantics"]);
      continue;
    }

    if (/(country|nation|residence|residency|citizenship)/.test(semanticHint)) {
      assign("country", 0.92, ["Rule matched country/residence semantics"]);
      continue;
    }

    if (/(preferred contact|best way to reach|contact method|reach you|contact channel|preferred channel|outreach channel|preferred outreach)/.test(semanticHint)) {
      assign("preferredContactMethod", 0.91, ["Rule matched preferred-contact semantics"]);
      continue;
    }

    if (/(notes|message|comments|additional info|about you|lead notes)/.test(semanticHint)) {
      assign("notes", 0.88, ["Rule matched notes/message semantics"]);
      continue;
    }

    if (/(terms|privacy|agree|consent)/.test(semanticHint)) {
      assign("acceptTerms", 0.9, ["Rule matched consent semantics"]);
      continue;
    }

    if (field.type === "select" && field.options?.length) {
      const lowerOptions = field.options.map((option) => option.toLowerCase());
      if (lowerOptions.includes(userProfile.name.toLowerCase())) {
        assign("name", 0.84, ["Dropdown options contain the profile name"], ["Select-option-only match"]);
        continue;
      }
      if (lowerOptions.includes(userProfile.country.toLowerCase())) {
        assign("country", 0.88, ["Dropdown options contain the profile country"]);
        continue;
      }
      if (lowerOptions.includes(userProfile.preferredContactMethod.toLowerCase())) {
        assign("preferredContactMethod", 0.88, ["Dropdown options contain the preferred contact method"]);
      }
    }
  }

  return values;
}

function getAmbiguousFields(
  fields: FormField[],
  mappingReport: MappingConfidenceReport
): FormField[] {
  return fields.filter((field) => {
    const report = mappingReport.fieldReports.find((fieldReport) => fieldReport.label === field.label);
    return report?.shouldUseLLM ?? true;
  });
}

function toCandidateScores(mappedKey: keyof UserProfile, score: number): MappingCandidateScore[] {
  return [{ key: mappedKey, score }];
}

function applyLlmMappings(
  ambiguousFields: FormField[],
  mappings: FieldValueMap,
  userProfile: UserProfile,
  mappedValues: FieldValueMap,
  decisions: Map<string, MappingDecisionInput>
): void {
  for (const field of ambiguousFields) {
    const rawMappedValue = mappings[field.label];
    if (!rawMappedValue) continue;

    const profileKeys = (Object.keys(userProfile) as Array<keyof UserProfile>).filter((key) => userProfile[key]);
    const returnedKey = profileKeys.find((key) => key === rawMappedValue);
    const matchedKey =
      returnedKey ??
      profileKeys.find((key) => userProfile[key] === rawMappedValue);

    if (!matchedKey) continue;

    const mappedValue = userProfile[matchedKey];
    if (!mappingCompatibleWithField(field, matchedKey, mappedValue)) continue;
    mappedValues[field.label] = mappedValue;
    decisions.set(field.label, {
      label: field.label,
      selector: field.selector,
      method: "llm",
      mappedKey: matchedKey,
      mappedValue,
      baseScore: 0.78,
      candidateScores: toCandidateScores(matchedKey, 0.78),
      reasons: ["LLM resolved an ambiguous or low-confidence field"],
      weaknesses: ["LLM fallback should still be reviewed by a human"],
    });
  }
}

export type MapFieldsOptions = {
  formContext?: string;
  page?: Page;
  deferredLlmExtraction?: boolean;
};

export interface MapFieldsResult {
  mappedValues: FieldValueMap;
  report: MappingConfidenceReport;
  fields: FormField[];
}

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
  extractionReport?: ExtractionConfidenceReport,
  options?: MapFieldsOptions
): Promise<MapFieldsResult> {
  const { formContext, page } = options ?? {};
  const decisions = new Map<string, MappingDecisionInput>();
  const mappedValues: FieldValueMap = {};
  let workingFields = fields;

  const ruleValues = ruleBasedMap(workingFields, userProfile);
  for (const [label, decision] of ruleValues.entries()) {
    mappedValues[label] = decision.mappedValue;
    decisions.set(label, {
      label,
      selector: workingFields.find((field) => field.label === label)?.selector ?? "",
      method: "rule",
      mappedKey: decision.mappedKey,
      mappedValue: decision.mappedValue,
      baseScore: decision.score,
      candidateScores: toCandidateScores(decision.mappedKey, decision.score),
      reasons: decision.reasons,
      weaknesses: decision.weaknesses,
    });
  }

  const semanticValues = semanticMatchFieldsDetailed(workingFields, userProfile, mappedValues);
  for (const [label, decision] of semanticValues.entries()) {
    mappedValues[label] = decision.mappedValue;
    decisions.set(label, {
      label,
      selector: workingFields.find((field) => field.label === label)?.selector ?? "",
      method: "semantic",
      mappedKey: decision.mappedKey,
      mappedValue: decision.mappedValue,
      baseScore: decision.score,
      candidateScores: decision.candidateScores,
      reasons: decision.reasons,
      weaknesses: decision.weaknesses,
    });
  }

  let fallbackReport = buildMappingConfidenceReport(workingFields, decisions, extractionReport);
  const ambiguousFields = getAmbiguousFields(workingFields, fallbackReport);

  if (!isGeminiConfigured() || ambiguousFields.length === 0) {
    return {
      mappedValues,
      report: fallbackReport,
      fields: workingFields,
    };
  }

  if (page) {
    const unified = await resolveFormWithLLM({
      page,
      fields: workingFields,
      ambiguousFields,
      userProfile,
      decisions,
      mappingReport: fallbackReport,
      extractionReport,
      formContext,
    });

    if (unified) {
      workingFields = unified.fields;
      const targets = getAmbiguousFields(workingFields, fallbackReport);
      applyLlmMappings(targets, unified.mappings, userProfile, mappedValues, decisions);

      fallbackReport = buildMappingConfidenceReport(workingFields, decisions, extractionReport);
      return {
        mappedValues,
        report: fallbackReport,
        fields: workingFields,
      };
    }

    return {
      mappedValues,
      report: fallbackReport,
      fields: workingFields,
    };
  }

  try {
    const content = await generateJsonWithGemini(
      [
        "You map ambiguous form field labels to the best matching user profile value.",
        "Use the form context, labels, names, placeholders, input types, and options to infer likely meaning.",
        "Use already mapped fields as anchors for the overall pattern of the form.",
        "Use the profile schema descriptions to understand what each available profile value represents.",
        "Prefer unused profile values when they clearly fit an unmapped field, and avoid duplicating an already mapped profile value unless the form truly asks for the same information twice.",
        "Consider field order and neighboring fields when labels are short or ambiguous.",
        "Never map an email-looking field to a non-email profile value. If the email value is missing, leave that field unmapped.",
        "Return strict JSON where each key is the exact field label and each value is the chosen text value.",
        "Only map fields when there is a clear fit.",
      ].join(" "),
      {
        fields: ambiguousFields,
        allFields: workingFields,
        alreadyMappedFields: buildMappedAnchors(decisions),
        alreadyMappedValues: mappedValues,
        availableProfileOptions: buildAvailableProfileOptions(decisions, userProfile),
        profileSchema: PROFILE_SCHEMA,
        userProfile,
        formContext,
      }
    );

    const parsed = JSON.parse(content) as FieldValueMap;
    applyLlmMappings(ambiguousFields, parsed, userProfile, mappedValues, decisions);

    fallbackReport = buildMappingConfidenceReport(workingFields, decisions, extractionReport);
    return {
      mappedValues,
      report: fallbackReport,
      fields: workingFields,
    };
  } catch (error) {
    console.warn("Falling back to rule-based mapping:", error);
    return {
      mappedValues,
      report: fallbackReport,
      fields: workingFields,
    };
  }
}
