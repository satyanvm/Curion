import { FieldValueMap, FormField, UserProfile } from "../types/types";
import { generateJsonWithGemini, isGeminiConfigured } from "./gemini";

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function ruleBasedMap(fields: FormField[], userProfile: UserProfile): FieldValueMap {
  const values: FieldValueMap = {};

  for (const field of fields) {
    const semanticHint = normalize([field.label, field.name ?? ""].join(" "));
    const fallbackHint = normalize(field.placeholder ?? "");
    const haystack = `${semanticHint} ${fallbackHint}`.trim();

    if (!haystack) continue;

    if (/(e mail|email|mail|follow up|reply to|contact email)/.test(semanticHint) || field.type === "email") {
      values[field.label] = userProfile.email;
      continue;
    }

    if (/(phone|mobile|telephone|tel|contact number|cell|whatsapp number)/.test(semanticHint) || field.type === "tel") {
      values[field.label] = userProfile.phone;
      continue;
    }

    if (/(full name|your name|person name|applicant name|applicant|candidate name|legal name)/.test(semanticHint)) {
      values[field.label] = userProfile.name;
      continue;
    }

    if (/(job title|role|designation|position)/.test(semanticHint)) {
      values[field.label] = userProfile.jobTitle;
      continue;
    }

    if (/(company|organization|organisation|employer)/.test(semanticHint)) {
      values[field.label] = userProfile.company;
      continue;
    }

    if (/(street address|address line|address)/.test(semanticHint)) {
      values[field.label] = userProfile.address;
      continue;
    }

    if (/(city|town)/.test(semanticHint)) {
      values[field.label] = userProfile.city;
      continue;
    }

    if (/(state|province|region)/.test(semanticHint)) {
      values[field.label] = userProfile.state;
      continue;
    }

    if (/(zip|postal code|postcode|pin code)/.test(semanticHint)) {
      values[field.label] = userProfile.postalCode;
      continue;
    }

    if (/(country|nation|residence|residency|citizenship)/.test(semanticHint)) {
      values[field.label] = userProfile.country;
      continue;
    }

    if (/(linkedin)/.test(semanticHint)) {
      values[field.label] = userProfile.linkedin;
      continue;
    }

    if (/(website|portfolio|homepage|site url)/.test(semanticHint)) {
      values[field.label] = userProfile.website;
      continue;
    }

    if (/(preferred contact|best way to reach|contact method|reach you|contact channel|preferred channel)/.test(semanticHint)) {
      values[field.label] = userProfile.preferredContactMethod;
      continue;
    }

    if (/(notes|message|comments|additional info|about you)/.test(semanticHint)) {
      values[field.label] = userProfile.notes;
      continue;
    }

    if (/(terms|privacy|agree|consent)/.test(semanticHint)) {
      values[field.label] = userProfile.acceptTerms;
      continue;
    }

    if (field.type === "select" && field.options?.length) {
      const lowerOptions = field.options.map((option) => option.toLowerCase());
      if (lowerOptions.includes(userProfile.name.toLowerCase())) {
        values[field.label] = userProfile.name;
        continue;
      }
      if (lowerOptions.includes(userProfile.country.toLowerCase())) {
        values[field.label] = userProfile.country;
        continue;
      }
      if (lowerOptions.includes(userProfile.preferredContactMethod.toLowerCase())) {
        values[field.label] = userProfile.preferredContactMethod;
      }
    }
  }

  return values;
}

function getAmbiguousFields(fields: FormField[], mappedValues: FieldValueMap): FormField[] {
  return fields.filter((field) => {
    if (mappedValues[field.label]) {
      return false;
    }

    if (field.type === "checkbox" || field.type === "radio") {
      return false;
    }

    return true;
  });
}

export async function mapFields(
  fields: FormField[],
  userProfile: UserProfile
): Promise<FieldValueMap> {
  const fallbackValues = ruleBasedMap(fields, userProfile);
  const ambiguousFields = getAmbiguousFields(fields, fallbackValues);

  // Keep the MVP self-contained: use rules by default and only try the API if
  // the key exists and native fetch is available in the current runtime.
  if (!isGeminiConfigured() || ambiguousFields.length === 0) {
    return fallbackValues;
  }

  try {
    const content = await generateJsonWithGemini(
      "You map ambiguous form field labels to the best matching user profile value. Return strict JSON where each key is the exact field label and each value is the chosen text value. Only map fields when there is a clear fit.",
      { fields: ambiguousFields, userProfile }
    );

    const parsed = JSON.parse(content) as FieldValueMap;
    return {
      ...fallbackValues,
      ...parsed,
    };
  } catch (error) {
    console.warn("Falling back to rule-based mapping:", error);
    return fallbackValues;
  }
}
