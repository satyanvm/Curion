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
import { semanticMatchFieldsDetailed } from "../semantic/semanticMatch";

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

type RuleFieldDecision = {
  mappedKey: keyof UserProfile;
  mappedValue: string;
  score: number;
  reasons: string[];
  weaknesses: string[];
};

const PROFILE_SCHEMA: Record<keyof UserProfile, string> = {
  name: "A person's full name.",
  email: "An email address.",
  phone: "A phone or mobile number.",
  company: "A company, organization, employer, or account name.",
  jobTitle: "A person's work role, position, designation, or title.",
  address: "A street or mailing address.",
  city: "A city, town, locality, or business market location.",
  state: "A state, province, region, or sales territory.",
  postalCode: "A postal code, ZIP code, postcode, or delivery zone.",
  country: "A country, nation, or geographic country-level value.",
  linkedin: "A LinkedIn profile URL.",
  website: "A website, homepage, portfolio, or company site URL.",
  preferredContactMethod: "The preferred contact, outreach, or follow-up channel.",
  notes: "Freeform notes, comments, message, memo, or contextual details.",
  acceptTerms: "A consent, agreement, opt-in, privacy, or terms checkbox value.",
};

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

function buildMappedAnchors(decisions: Map<string, MappingDecisionInput>): Array<{
  label: string;
  mappedKey: keyof UserProfile;
  mappedValue: string;
  method: MappingDecisionInput["method"];
  score: number;
}> {
  return Array.from(decisions.values()).map((decision) => ({
    label: decision.label,
    mappedKey: decision.mappedKey,
    mappedValue: decision.mappedValue,
    method: decision.method,
    score: decision.baseScore,
  }));
}

function buildAvailableProfileOptions(decisions: Map<string, MappingDecisionInput>, userProfile: UserProfile): Array<{
  key: keyof UserProfile;
  description: string;
  value: string;
}> {
  const mappedKeys = new Set(Array.from(decisions.values()).map((decision) => decision.mappedKey));

  return (Object.keys(userProfile) as Array<keyof UserProfile>)
    .filter((key) => !mappedKeys.has(key))
    .map((key) => ({
      key,
      description: PROFILE_SCHEMA[key],
      value: userProfile[key],
    }));
}

export interface MapFieldsResult {
  mappedValues: FieldValueMap;
  report: MappingConfidenceReport;
}

export async function mapFields(
  fields: FormField[],
  userProfile: UserProfile,
  extractionReport?: ExtractionConfidenceReport,
  formContext?: string
): Promise<FieldValueMap> {
  const result = await mapFieldsWithConfidence(fields, userProfile, extractionReport, formContext);
  return result.mappedValues;
}

export async function mapFieldsWithConfidence(
  fields: FormField[],
  userProfile: UserProfile,
  extractionReport?: ExtractionConfidenceReport,
  formContext?: string
): Promise<MapFieldsResult> {
  const decisions = new Map<string, MappingDecisionInput>();
  const mappedValues: FieldValueMap = {};

  const ruleValues = ruleBasedMap(fields, userProfile);
  for (const [label, decision] of ruleValues.entries()) {
    mappedValues[label] = decision.mappedValue;
    decisions.set(label, {
      label,
      selector: fields.find((field) => field.label === label)?.selector ?? "",
      method: "rule",
      mappedKey: decision.mappedKey,
      mappedValue: decision.mappedValue,
      baseScore: decision.score,
      candidateScores: toCandidateScores(decision.mappedKey, decision.score),
      reasons: decision.reasons,
      weaknesses: decision.weaknesses,
    });
  }

  const semanticValues = semanticMatchFieldsDetailed(fields, userProfile, mappedValues);
  for (const [label, decision] of semanticValues.entries()) {
    mappedValues[label] = decision.mappedValue;
    decisions.set(label, {
      label,
      selector: fields.find((field) => field.label === label)?.selector ?? "",
      method: "semantic",
      mappedKey: decision.mappedKey,
      mappedValue: decision.mappedValue,
      baseScore: decision.score,
      candidateScores: decision.candidateScores,
      reasons: decision.reasons,
      weaknesses: decision.weaknesses,
    });
  }

  let fallbackReport = buildMappingConfidenceReport(fields, decisions, extractionReport);
  const ambiguousFields = getAmbiguousFields(fields, fallbackReport);

  // Keep the MVP self-contained: use rules by default and only try the API if
  // the key exists and native fetch is available in the current runtime.
  if (!isGeminiConfigured() || ambiguousFields.length === 0) {
    return {
      mappedValues,
      report: fallbackReport,
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
        "Return strict JSON where each key is the exact field label and each value is the chosen text value.",
        "Only map fields when there is a clear fit.",
      ].join(" "),
      {
        fields: ambiguousFields,
        allFields: fields,
        alreadyMappedFields: buildMappedAnchors(decisions),
        alreadyMappedValues: mappedValues,
        availableProfileOptions: buildAvailableProfileOptions(decisions, userProfile),
        profileSchema: PROFILE_SCHEMA,
        userProfile,
        formContext,
      }
    );

    const parsed = JSON.parse(content) as FieldValueMap;
    for (const field of ambiguousFields) {
      const mappedValue = parsed[field.label];
      if (!mappedValue) continue;

      mappedValues[field.label] = mappedValue;
      const matchedKey = (Object.keys(userProfile) as Array<keyof UserProfile>).find(
        (key) => userProfile[key] === mappedValue
      );

      if (!matchedKey) continue;

      decisions.set(field.label, {
        label: field.label,
        selector: field.selector,
        method: "llm",
        mappedKey: matchedKey,
        mappedValue,
        baseScore: 0.78,
        candidateScores: toCandidateScores(matchedKey, 0.78),
        reasons: ["LLM fallback resolved an ambiguous or low-confidence field"],
        weaknesses: ["LLM fallback should still be reviewed by a human"],
      });
    }

    fallbackReport = buildMappingConfidenceReport(fields, decisions, extractionReport);
    return {
      mappedValues,
      report: fallbackReport,
    };
  } catch (error) {
    console.warn("Falling back to rule-based mapping:", error);
    return {
      mappedValues,
      report: fallbackReport,
    };
  }
}
