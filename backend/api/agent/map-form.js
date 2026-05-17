const HTML_SNIPPET_LIMIT = 25000;

const PROFILE_SCHEMA = {
  name: {
    description: "A person's full name.",
    aliases: ["name", "full name", "your name", "contact name", "applicant", "candidate", "primary contact"]
  },
  email: {
    description: "An email address.",
    aliases: ["email", "e mail", "e-mail", "mail", "inbox", "reply to", "follow up email"]
  },
  phone: {
    description: "A phone or mobile number.",
    aliases: ["phone", "mobile", "telephone", "tel", "line", "contact number", "whatsapp"]
  },
  company: {
    description: "A company, organization, employer, or account name.",
    aliases: ["company", "organization", "organisation", "employer", "account", "business"]
  },
  jobTitle: {
    description: "A person's work role, position, designation, or title.",
    aliases: ["job title", "role", "designation", "position", "seat", "title"]
  },
  address: {
    description: "A street or mailing address.",
    aliases: ["address", "street address", "street", "base", "mailing", "address line"]
  },
  city: {
    description: "A city, town, locality, or business market location.",
    aliases: ["city", "town", "market", "locality"]
  },
  state: {
    description: "A state, province, region, or sales territory.",
    aliases: ["state", "province", "region", "territory"]
  },
  postalCode: {
    description: "A postal code, ZIP code, postcode, or delivery zone.",
    aliases: ["postal code", "zip", "postcode", "pin code", "zone"]
  },
  country: {
    description: "A country, nation, or geographic country-level value.",
    aliases: ["country", "nation", "geo", "residence"]
  },
  linkedin: {
    description: "A LinkedIn profile URL.",
    aliases: ["linkedin", "linkedin url", "linkedin profile", "professional profile", "profile"]
  },
  website: {
    description: "A website, homepage, portfolio, or company site URL.",
    aliases: ["website", "portfolio", "homepage", "source", "site url"]
  },
  preferredContactMethod: {
    description: "The preferred contact, outreach, or follow-up channel.",
    aliases: ["preferred contact", "contact method", "reach", "next touch", "channel", "preferred channel"]
  },
  notes: {
    description: "Freeform notes, comments, message, memo, or contextual details.",
    aliases: ["notes", "message", "comments", "context", "additional info", "about you"]
  },
  acceptTerms: {
    description: "A consent, agreement, opt-in, privacy, or terms checkbox value.",
    aliases: ["terms", "privacy", "agree", "consent", "ok to proceed", "policy"]
  }
};

function setCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

function normalize(text) {
  return String(text || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function clamp(value) {
  return Math.max(0, Math.min(1, value));
}

function json(response, statusCode, payload) {
  setCorsHeaders(response);
  response.status(statusCode).json(payload);
}

function sanitizeField(field, index) {
  const type = String(field?.type || "text").toLowerCase();
  return {
    index: Number.isInteger(field?.index) ? field.index : index,
    label: String(field?.label || field?.name || field?.placeholder || `Field ${index + 1}`),
    selector: String(field?.selector || ""),
    type,
    labelSource: field?.labelSource || "name",
    name: String(field?.name || ""),
    placeholder: String(field?.placeholder || ""),
    options: Array.isArray(field?.options) ? field.options.map(String).filter(Boolean).slice(0, 60) : []
  };
}

function sanitizeProfile(profile) {
  const clean = {};
  for (const key of Object.keys(PROFILE_SCHEMA)) {
    clean[key] = String(profile?.[key] || "");
  }
  return clean;
}

function isReadableText(text) {
  if (!text) return false;
  return /^[a-z0-9][a-z0-9\s/()_-]{2,}$/i.test(text) && !/(ctl\d+|field[_-]?\d+|input[_-]?\d+)/i.test(text);
}

function labelSourceScore(source) {
  if (["label", "aria-label", "aria-labelledby"].includes(source)) return 0.95;
  if (source === "parent-label") return 0.82;
  if (source === "placeholder") return 0.62;
  if (source === "name") return 0.5;
  if (source === "id") return 0.38;
  if (source === "llm") return 0.88;
  return 0.45;
}

function selectorScore(selector) {
  if (selector.startsWith("#")) return 0.95;
  if (/\[name=/.test(selector)) return 0.82;
  if (/\[data-testid=/.test(selector)) return 0.78;
  if (/\[placeholder=/.test(selector)) return 0.62;
  if (selector.includes(" > ")) return 0.42;
  return 0.55;
}

function typeScore(type) {
  if (["email", "tel", "url", "select", "textarea", "checkbox", "radio"].includes(type)) return 0.9;
  if (type === "text") return 0.72;
  return 0.45;
}

function fieldMeaning(field) {
  return normalize([field.label, field.name, field.placeholder, field.type, ...(field.options || [])].join(" "));
}

function requiredKeyForField(field) {
  const meaning = fieldMeaning(field);
  if (field.type === "email" || /(^| )(email|e mail)( |$)/.test(meaning)) return "email";
  if (field.type === "tel" || /(^| )(phone|mobile|telephone|tel)( |$)/.test(meaning)) return "phone";
  return null;
}

function isEmailValue(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function isMappingCompatible(field, key, value) {
  const requiredKey = requiredKeyForField(field);
  if (!requiredKey) return true;
  if (key !== requiredKey) return false;
  if (requiredKey === "email") return isEmailValue(value);
  return true;
}

function calculateExtractionConfidence(fields) {
  if (fields.length === 0) {
    return {
      overallScore: 0,
      shouldUseLLM: true,
      reasons: ["No fields were extracted from the DOM"],
      fieldReports: [],
      weakFieldRatio: 1
    };
  }

  const fieldReports = fields.map((field) => {
    const readableLabel = isReadableText(field.label);
    const score = clamp(
      labelSourceScore(field.labelSource) * 0.35 +
        (readableLabel ? 0.9 : 0.35) * 0.2 +
        selectorScore(field.selector) * 0.2 +
        typeScore(field.type) * 0.15 +
        0.45 * 0.1
    );

    return {
      selector: field.selector,
      label: field.label,
      score,
      reasons: readableLabel ? ["Label looks human-readable"] : [],
      weaknesses: readableLabel ? [] : ["Label looks machine-generated or unclear"],
      recommendedAction: score < 0.55 ? "repair-with-llm" : score < 0.72 ? "review" : "trust"
    };
  });

  const overallScore = clamp(fieldReports.reduce((sum, report) => sum + report.score, 0) / fields.length);
  const weakFieldCount = fieldReports.filter((report) => report.score < 0.6).length;
  const repairCount = fieldReports.filter((report) => report.recommendedAction === "repair-with-llm").length;
  const weakFieldRatio = weakFieldCount / fields.length;
  const reasons = [];
  if (overallScore < 0.68) reasons.push("Average extraction confidence is low");
  if (weakFieldRatio >= 0.35) reasons.push("Too many fields have weak extraction confidence");
  if (repairCount >= 2) reasons.push("Multiple fields need extraction repair");

  return {
    overallScore,
    shouldUseLLM: overallScore < 0.68 || weakFieldRatio >= 0.35 || repairCount >= 2,
    reasons,
    fieldReports,
    weakFieldRatio
  };
}

function scoreCandidate(field, key, profile) {
  if (!profile[key]) return 0;
  if (!isMappingCompatible(field, key, profile[key])) return 0;
  const meaning = fieldMeaning(field);
  const aliases = [key, ...PROFILE_SCHEMA[key].aliases];
  let score = 0;

  for (const alias of aliases) {
    const normalizedAlias = normalize(alias);
    if (!normalizedAlias) continue;
    if (meaning === normalizedAlias) score = Math.max(score, 0.96);
    if (meaning.includes(normalizedAlias)) score = Math.max(score, normalizedAlias.includes(" ") ? 0.88 : 0.76);
  }

  if (field.type === "email" && key === "email") score += 0.45;
  if (field.type === "tel" && key === "phone") score += 0.45;
  if (field.type === "url" && (key === "linkedin" || key === "website")) score += 0.35;

  if (field.type === "select") {
    const optionMatch = field.options?.some((option) => normalize(option) === normalize(profile[key]));
    if (optionMatch) score += 0.35;
  }

  return clamp(score);
}

function deterministicMap(fields, profile, extractionReport) {
  const mappings = [];
  const usedKeys = new Set();

  for (const field of fields) {
    const ranked = Object.keys(PROFILE_SCHEMA)
      .filter((key) => profile[key])
      .map((key) => ({ key, score: scoreCandidate(field, key, profile) }))
      .sort((left, right) => right.score - left.score);

    const best = ranked[0];
    const runnerUp = ranked[1];
    const gap = best && runnerUp ? best.score - runnerUp.score : best?.score || 0;
    const extractionField = extractionReport.fieldReports.find((report) => report.selector === field.selector);
    const confidence = clamp((best?.score || 0) * 0.75 + (extractionField?.score || 0) * 0.25);
    const isConfident = Boolean(best && best.score >= 0.82 && gap >= 0.1);

    mappings.push({
      field,
      mapping: isConfident
        ? {
            key: best.key,
            value: profile[best.key],
            confidence,
            method: "deterministic",
            reasons: [`Top deterministic candidate is ${best.key}`],
            reviewRequired: confidence < 0.8 || usedKeys.has(best.key)
          }
        : null,
      candidates: ranked.slice(0, 3)
    });

    if (isConfident) usedKeys.add(best.key);
  }

  return mappings;
}

function buildAvailableProfileOptions(profile, mappings) {
  const usedKeys = new Set(mappings.map((entry) => entry.mapping?.key).filter(Boolean));
  return Object.keys(PROFILE_SCHEMA)
    .filter((key) => profile[key] && !usedKeys.has(key))
    .map((key) => ({
      key,
      description: PROFILE_SCHEMA[key].description,
      value: profile[key]
    }));
}

function getGeminiApiKey() {
  return process.env.GEMINI_API_KEY || process.env.gemini_api_key;
}

function getGeminiModel() {
  return process.env.GEMINI_MODEL || process.env.gemini_model || "gemini-2.5-flash";
}

async function generateJsonWithGemini(systemInstruction, payload) {
  const apiKey = getGeminiApiKey();
  if (!apiKey || typeof fetch !== "function") {
    throw new Error("Gemini API key is not configured");
  }

  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${getGeminiModel()}:generateContent?key=${apiKey}`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      systemInstruction: {
        parts: [{ text: systemInstruction }]
      },
      contents: [
        {
          role: "user",
          parts: [{ text: JSON.stringify(payload) }]
        }
      ],
      generationConfig: {
        temperature: 0,
        responseMimeType: "application/json"
      }
    })
  });

  if (!response.ok) {
    throw new Error(`Gemini request failed with status ${response.status}`);
  }

  const result = await response.json();
  const content = result.candidates?.[0]?.content?.parts?.map((part) => part.text || "").join("").trim();
  if (!content) throw new Error("Gemini response was empty");
  return JSON.parse(content);
}

function normalizeLlmMappings(llmMappings, profile) {
  const normalized = {};
  for (const [label, rawValue] of Object.entries(llmMappings || {})) {
    const value = String(rawValue || "");
    const returnedKey = Object.keys(PROFILE_SCHEMA).find((key) => key === value);
    const matchedKey = returnedKey || Object.keys(PROFILE_SCHEMA).find((key) => profile[key] === value);
    if (matchedKey) {
      normalized[label] = {
        key: matchedKey,
        value: profile[matchedKey]
      };
    }
  }
  return normalized;
}

async function repairWithLlm({ body, fields, profile, extractionReport, deterministicMappings }) {
  const targetFields = deterministicMappings
    .filter((entry) => !entry.mapping || entry.mapping.confidence < 0.8)
    .map((entry) => ({
      field: entry.field,
      currentMapping: entry.mapping,
      candidates: entry.candidates
    }));

  if (targetFields.length === 0 || !getGeminiApiKey()) {
    return null;
  }

  return generateJsonWithGemini(
    [
      "You are Curion's form mapping agent.",
      "Map every low-confidence or unmapped target field to the best profile value.",
      "Use the page HTML, field metadata, extraction confidence, deterministic guesses, already mapped anchors, and profile schema.",
      "Return strict JSON with a mappings object keyed by exact field label.",
      "Mapping values must be actual profile values, never profile key names like company, city, state, postalCode, notes, or acceptTerms.",
      "Never map an email-looking field to a non-email profile value. If the email value is missing, leave that field unmapped.",
      "Only map a field when there is a clear fit."
    ].join(" "),
    {
      goal: body.goal || "Fill this form with the saved profile.",
      url: body.url,
      title: body.title,
      html: String(body.html || "").slice(0, HTML_SNIPPET_LIMIT),
      fields,
      targetFields,
      alreadyMappedFields: deterministicMappings
        .filter((entry) => entry.mapping && entry.mapping.confidence >= 0.8)
        .map((entry) => ({
          label: entry.field.label,
          mappedKey: entry.mapping.key,
          mappedValue: entry.mapping.value,
          confidence: entry.mapping.confidence
        })),
      availableProfileOptions: buildAvailableProfileOptions(profile, deterministicMappings),
      profileSchema: Object.fromEntries(
        Object.entries(PROFILE_SCHEMA).map(([key, value]) => [key, value.description])
      ),
      profile,
      extractionConfidence: extractionReport
    }
  );
}

function mergeLlmMappings(deterministicMappings, llmMappings, profile) {
  const normalized = normalizeLlmMappings(llmMappings, profile);
  return deterministicMappings.map((entry) => {
    const llmMapping = normalized[entry.field.label];
    if (!llmMapping) return entry;
    if (!isMappingCompatible(entry.field, llmMapping.key, llmMapping.value)) return entry;

    return {
      ...entry,
      mapping: {
        key: llmMapping.key,
        value: llmMapping.value,
        confidence: 0.82,
        method: "llm",
        reasons: ["LLM resolved a low-confidence or unmapped field"],
        reviewRequired: false
      }
    };
  });
}

function summarize(mappings, extractionReport, source, warnings = []) {
  const mapped = mappings.filter((entry) => entry.mapping);
  const mappedCount = mapped.length;
  const mappingAverage =
    mapped.reduce((sum, entry) => sum + entry.mapping.confidence, 0) / Math.max(mappedCount, 1);
  const overallConfidence = clamp(mappingAverage * 0.7 + extractionReport.overallScore * 0.3);

  return {
    source,
    fieldCount: mappings.length,
    mappedCount,
    overallConfidence,
    reviewRequired:
      overallConfidence < 0.8 ||
      mappings.some((entry) => !entry.mapping || entry.mapping.reviewRequired),
    extractionReport,
    warnings,
    mappings
  };
}

export default async function handler(request, response) {
  setCorsHeaders(response);

  if (request.method === "OPTIONS") {
    response.status(204).end();
    return;
  }

  if (request.method !== "POST") {
    json(response, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const body = request.body || {};
    const fields = Array.isArray(body.fields) ? body.fields.map(sanitizeField) : [];
    const profile = sanitizeProfile(body.profile || {});
    const extractionReport = calculateExtractionConfidence(fields);
    const deterministicMappings = deterministicMap(fields, profile, extractionReport);

    let mappings = deterministicMappings;
    let source = "deterministic";
    const warnings = [];

    try {
      const llmResult = await repairWithLlm({
        body,
        fields,
        profile,
        extractionReport,
        deterministicMappings
      });

      if (llmResult?.mappings) {
        mappings = mergeLlmMappings(deterministicMappings, llmResult.mappings, profile);
        source = "llm";
      }
    } catch (error) {
      warnings.push(error.message || "LLM mapping failed; deterministic mappings returned");
    }

    json(response, 200, summarize(mappings, extractionReport, source, warnings));
  } catch (error) {
    json(response, 400, {
      error: error.message || "Unable to map form"
    });
  }
}
