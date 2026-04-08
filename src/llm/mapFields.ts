import { FieldValueMap, FormField, UserProfile } from "../types/types";

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

    if (/(e mail|email|mail)/.test(semanticHint) || field.type === "email") {
      values[field.label] = userProfile.email;
      continue;
    }

    if (/(phone|mobile|telephone|tel|contact number)/.test(semanticHint) || field.type === "tel") {
      values[field.label] = userProfile.phone;
      continue;
    }

    if (/(full name|your name|person name|applicant name)/.test(semanticHint)) {
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

    if (/(country|nation)/.test(semanticHint)) {
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

    if (/(preferred contact|best way to reach|contact method)/.test(semanticHint)) {
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

export async function mapFields(
  fields: FormField[],
  userProfile: UserProfile
): Promise<FieldValueMap> {
  const apiKey = process.env.OPENAI_API_KEY;

  // Keep the MVP self-contained: use rules by default and only try the API if
  // the key exists and native fetch is available in the current runtime.
  if (!apiKey || typeof fetch !== "function") {
    return ruleBasedMap(fields, userProfile);
  }

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You map form field labels to the best matching user profile value. Return strict JSON where each key is the exact field label and each value is the chosen text value. Only map fields when there is a clear fit.",
          },
          {
            role: "user",
            content: JSON.stringify({ fields, userProfile }),
          },
        ],
      }),
    });

    if (!response.ok) {
      throw new Error(`OpenAI request failed with status ${response.status}`);
    }

    const json = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = json.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("OpenAI response was empty");
    }

    const parsed = JSON.parse(content) as FieldValueMap;
    return parsed;
  } catch (error) {
    console.warn("Falling back to rule-based mapping:", error);
    return ruleBasedMap(fields, userProfile);
  }
}
