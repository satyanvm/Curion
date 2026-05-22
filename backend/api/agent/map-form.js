import {
  batchEmbedTexts,
  clamp,
  cosineSimilarity,
  json,
  normalizeText,
  profileAtomsFromProfile,
  semanticConceptForPath,
  setCorsHeaders,
  supabaseRpc,
  supabaseSelectRows
} from "../_lib/semantic-profile.js";
import { generateJsonWithGemini, isGeminiConfigured } from "../_lib/gemini.js";

const DEFAULT_MATCH_COUNT = 5;
const DEFAULT_MAX_DISTANCE = 0.42;
const HTML_SNIPPET_LIMIT = 12000;
const LLM_MAPPING_CONFIDENCE = 0.78;

const PROFILE_SCHEMA = {
  firstName: "A person's first or given name.",
  lastName: "A person's last name, surname, or family name.",
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
  acceptTerms: "A consent, agreement, opt-in, privacy, or terms checkbox value."
};

function normalizeChoice(text) {
  return normalizeText(text);
}

function setNestedValue(target, path, value) {
  const segments = String(path || "").split(".").filter(Boolean);
  if (segments.length === 0) return;

  let current = target;
  while (segments.length > 1) {
    const segment = segments.shift();
    if (!current[segment] || typeof current[segment] !== "object" || Array.isArray(current[segment])) {
      current[segment] = {};
    }
    current = current[segment];
  }

  current[segments[0]] = value;
}

function profileFromAtoms(atoms) {
  const profile = {};
  for (const atom of atoms || []) {
    if (!atom?.semanticPath || atom.rawValue === undefined || atom.rawValue === null || atom.rawValue === "") {
      continue;
    }
    setNestedValue(profile, atom.semanticPath, atom.rawValue);
  }
  return profile;
}

function buildProfileAtomOptions(atoms, limit = 60) {
  return (atoms || []).slice(0, limit).map((atom) => ({
    semanticPath: atom.semanticPath,
    rawValue: atom.rawValue,
    concept: semanticConceptForPath(atom.semanticPath)
  }));
}

function resolveAtomChoice(choice, atoms) {
  const normalizedChoice = normalizeChoice(choice);
  if (!normalizedChoice) return null;

  return (atoms || []).find((atom) => {
    const semanticPath = normalizeChoice(atom.semanticPath);
    const rawValue = normalizeChoice(atom.rawValue);
    const leaf = normalizeChoice(String(atom.semanticPath || "").split(".").pop() || "");
    return (
      semanticPath === normalizedChoice ||
      rawValue === normalizedChoice ||
      leaf === normalizedChoice
    );
  }) || null;
}

function mappingFromAtom(field, atom, confidence = LLM_MAPPING_CONFIDENCE) {
  if (!atom || !candidateCompatible(field, atom)) return null;

  return {
    key: atom.semanticPath,
    semanticPath: atom.semanticPath,
    value: atom.rawValue,
    confidence: clamp(confidence),
    method: "llm",
    reasons: [`Gemini resolved the field to stored profile atom ${atom.semanticPath}`],
    reviewRequired: confidence < 0.8
  };
}

async function loadProfileAtoms(body, userId) {
  if (userId) {
    const rows = await supabaseSelectRows("profile_atoms", {
      select: "semantic_path,raw_value,embedding_text",
      user_id: `eq.${userId}`,
      order: "semantic_path.asc"
    });

    return Array.isArray(rows)
      ? rows
          .map((row) => ({
            semanticPath: String(row.semantic_path || ""),
            rawValue: String(row.raw_value || ""),
            embeddingText: String(row.embedding_text || "")
          }))
          .filter((atom) => atom.semanticPath && atom.rawValue)
      : [];
  }

  if (body?.profile && typeof body.profile === "object" && !Array.isArray(body.profile)) {
    return profileAtomsFromProfile(body.profile);
  }

  return [];
}

function buildLlmResolutionPrompt(body, fields, mappings, profileAtoms, sourceLabel) {
  const unresolvedFields = mappings
    .filter((entry) => !entry.mapping || entry.mapping.reviewRequired)
    .map((entry) => ({
      label: entry.field.label,
      selector: entry.field.selector,
      type: entry.field.type,
      name: entry.field.name,
      placeholder: entry.field.placeholder,
      options: entry.field.options,
      candidates: entry.candidates,
      currentMapping: entry.mapping
        ? {
            key: entry.mapping.key,
            semanticPath: entry.mapping.semanticPath,
            value: entry.mapping.value,
            confidence: entry.mapping.confidence
          }
        : null
    }));

  return {
    goal: body?.goal || "Fill this page with the active Curion metadata.",
    sourceLabel,
    url: body?.url || "",
    title: body?.title || "",
    htmlSnippet: body?.html ? String(body.html).slice(0, HTML_SNIPPET_LIMIT) : "",
    fields,
    unresolvedFields,
    alreadyMappedFields: mappings
      .filter((entry) => entry.mapping)
      .map((entry) => ({
        label: entry.field.label,
        semanticPath: entry.mapping.semanticPath,
        rawValue: entry.mapping.value,
        confidence: entry.mapping.confidence,
        method: entry.mapping.method
      })),
    alreadyMappedValues: Object.fromEntries(
      mappings.filter((entry) => entry.mapping).map((entry) => [entry.field.label, entry.mapping.value])
    ),
    availableProfileOptions: buildProfileAtomOptions(profileAtoms.filter((atom) => atom.rawValue)),
    profileSchema: PROFILE_SCHEMA,
    profileAtoms: buildProfileAtomOptions(profileAtoms, 80),
    profileObject: profileFromAtoms(profileAtoms)
  };
}

async function applyLlmFallback(body, fields, mappings, source, userId, extractionReport, warnings) {
  if (!isGeminiConfigured()) {
    return { mappings, source, warnings };
  }

  const profileAtoms = await loadProfileAtoms(body, userId);
  if (profileAtoms.length === 0) {
    return { mappings, source, warnings };
  }

  const shouldUseLlm =
    mappings.some((entry) => !entry.mapping || entry.mapping.reviewRequired) ||
    summarize(mappings, extractionReport, source, warnings).overallConfidence < 0.78;

  if (!shouldUseLlm) {
    return { mappings, source, warnings };
  }

  const prompt = buildLlmResolutionPrompt(body, fields, mappings, profileAtoms, source);

  try {
    const content = await generateJsonWithGemini(
      [
        "You resolve low-confidence HTML form fields using stored profile atoms.",
        "Return strict JSON where each key is an exact unresolved field label and each value is the exact semanticPath of the best matching profile atom.",
        "Only use semanticPath values from the availableProfileOptions list.",
        "Prefer unused profile atoms unless the form clearly repeats information.",
        "Only map a field when the fit is clear.",
        "Never invent values; map fields to stored profile atoms only."
      ].join(" "),
      prompt
    );

    const parsed = JSON.parse(content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("Gemini response was not a JSON object");
    }

    const byLabel = new Map(mappings.map((entry) => [entry.field.label, entry]));
    for (const [fieldLabel, chosenValue] of Object.entries(parsed)) {
      const entry = byLabel.get(fieldLabel);
      if (!entry) continue;

      const atom = resolveAtomChoice(chosenValue, profileAtoms);
      const mapping = mappingFromAtom(entry.field, atom, LLM_MAPPING_CONFIDENCE);
      if (!mapping) continue;
      entry.mapping = mapping;
    }

    warnings.push("Gemini resolved low-confidence fields using stored profile atoms");
    return {
      mappings,
      source: `${source}+llm`,
      warnings
    };
  } catch (error) {
    warnings.push(`Gemini fallback failed: ${error.message || "unknown error"}`);
    return { mappings, source, warnings };
  }
}

function sanitizeField(field, index) {
  const type = String(field?.type || "text").toLowerCase();
  return {
    id: String(field?.id || field?.selector || field?.name || `field-${index + 1}`),
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

function calculateExtractionConfidence(fields) {
  if (fields.length === 0) {
    return {
      overallScore: 0,
      shouldUseLLM: false,
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
      id: field.id,
      selector: field.selector,
      label: field.label,
      score,
      reasons: readableLabel ? ["Label looks human-readable"] : [],
      weaknesses: readableLabel ? [] : ["Label looks machine-generated or unclear"],
      recommendedAction: score < 0.55 ? "repair-field-extraction" : score < 0.72 ? "review" : "trust"
    };
  });

  const overallScore = clamp(fieldReports.reduce((sum, report) => sum + report.score, 0) / fields.length);
  const weakFieldCount = fieldReports.filter((report) => report.score < 0.6).length;
  const weakFieldRatio = weakFieldCount / fields.length;
  const reasons = [];
  if (overallScore < 0.68) reasons.push("Average extraction confidence is low");
  if (weakFieldRatio >= 0.35) reasons.push("Too many fields have weak extraction confidence");

  return {
    overallScore,
    shouldUseLLM: false,
    reasons,
    fieldReports,
    weakFieldRatio
  };
}

function fieldConceptHints(field) {
  const meaning = normalizeText([field.label, field.name, field.placeholder, field.type].join(" "));
  const hints = [];

  if (field.type === "email" || /(^| )(email|e mail|mail)( |$)/.test(meaning)) {
    hints.push("email address", "electronic contact detail");
  }
  if (field.type === "tel" || /(^| )(phone|mobile|telephone|tel|whatsapp)( |$)/.test(meaning)) {
    hints.push("phone number", "mobile telephone contact detail");
  }
  if (field.type === "url" || /(^| )(url|website|linkedin|portfolio|homepage)( |$)/.test(meaning)) {
    hints.push("website URL", "profile link", "web presence");
  }
  if (/(^| )(first|given|forename|fname)( |$)/.test(meaning)) {
    hints.push("first name", "given name", "personal identity entry");
  }
  if (/(^| )(last|family|surname|lname)( |$)/.test(meaning)) {
    hints.push("last name", "family name", "surname", "personal identity entry");
  }
  if (/(^| )(full name|your name|name)( |$)/.test(meaning)) {
    hints.push("full name", "contact identity entry");
  }
  if (/(company|organization|organisation|employer|business)/.test(meaning)) {
    hints.push("company", "organization", "employer", "business account");
  }
  if (/(job title|role|position|designation|title)/.test(meaning)) {
    hints.push("job title", "work role", "position");
  }
  if (/(address|street|address line|line 1|line 2)/.test(meaning)) {
    hints.push("street address", "mailing address", "delivery address");
  }
  if (/(city|town|locality)/.test(meaning)) hints.push("city", "town", "locality");
  if (/(state|province|region|territory)/.test(meaning)) hints.push("state", "province", "region");
  if (/(postal|zip|postcode|pin code)/.test(meaning)) hints.push("postal code", "ZIP code", "postcode");
  if (/(country|nation)/.test(meaning)) hints.push("country", "nation");
  if (/(terms|privacy|agree|consent|policy|opt in)/.test(meaning)) {
    hints.push("terms agreement", "privacy consent", "opt-in");
  }
  if (/(notes|message|comments|about|memo)/.test(meaning)) {
    hints.push("notes", "message", "freeform comments");
  }

  return [...new Set(hints)];
}

function embeddingTextForField(field, body) {
  const hints = fieldConceptHints(field);
  const optionText = field.options.length > 0 ? ` Options: ${field.options.slice(0, 12).join(", ")}.` : "";
  const pageContext = [body?.title, body?.url]
    .map((value) => String(value || "").slice(0, 160))
    .filter(Boolean)
    .join(" | ");

  return [
    "Web form field metadata query.",
    `Label: ${field.label || "blank"}.`,
    `Name attribute: ${field.name || "blank"}.`,
    `Placeholder: ${field.placeholder || "blank"}.`,
    `Input type: ${field.type || "text"}.`,
    optionText,
    hints.length ? `Concept hints: ${hints.join(", ")}.` : "",
    pageContext ? `Page context: ${pageContext}.` : "",
    body?.html ? `Nearby document context excerpt length: ${String(body.html).slice(0, HTML_SNIPPET_LIMIT).length}.` : ""
  ]
    .filter(Boolean)
    .join(" ");
}

function requiredValueKind(field) {
  const meaning = normalizeText([field.label, field.name, field.placeholder, field.type].join(" "));
  if (field.type === "email" || /(^| )(email|e mail)( |$)/.test(meaning)) return "email";
  if (field.type === "tel" || /(^| )(phone|mobile|telephone|tel)( |$)/.test(meaning)) return "phone";
  if (field.type === "url" || /(^| )(url|website|linkedin|portfolio)( |$)/.test(meaning)) return "url";
  if (field.type === "checkbox" || /(^| )(terms|privacy|agree|consent|policy|opt in)( |$)/.test(meaning)) return "consent";
  return null;
}

function isEmailValue(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function isPhoneValue(value) {
  return /(\+?\d[\d\s().-]{6,}\d)|whatsapp/i.test(String(value || ""));
}

function isUrlValue(value) {
  return /^(https?:\/\/|www\.|[a-z0-9.-]+\.[a-z]{2,})/i.test(String(value || "").trim());
}

function isConsentValue(value) {
  return /^(true|yes|y|1|agree|accepted|on)$/i.test(String(value || "").trim());
}

function candidateCompatible(field, candidate) {
  const required = requiredValueKind(field);
  if (!required) return true;

  const path = normalizeText(candidate.semantic_path || candidate.semanticPath || "");
  const value = String(candidate.raw_value || candidate.rawValue || "");

  if (required === "email") return path.includes("email") || isEmailValue(value);
  if (required === "phone") return path.includes("phone") || path.includes("mobile") || isPhoneValue(value);
  if (required === "url") return path.includes("url") || path.includes("website") || path.includes("linkedin") || isUrlValue(value);
  if (required === "consent") return isConsentValue(value);
  return true;
}

function optionBoost(field, candidate) {
  if (field.type !== "select" || !field.options.length) return 0;
  const rawValue = normalizeText(candidate.raw_value || candidate.rawValue || "");
  return field.options.some((option) => normalizeText(option) === rawValue) ? 0.08 : 0;
}

function confidenceFromDistance(distance, field, candidate, extractionScore) {
  const semanticScore = clamp(1 - Number(distance || 0));
  return clamp(semanticScore * 0.82 + extractionScore * 0.1 + optionBoost(field, candidate));
}

function groupMatchesByField(matches) {
  const grouped = new Map();
  for (const match of matches || []) {
    const queryIndex = Number(match.query_index);
    if (!grouped.has(queryIndex)) grouped.set(queryIndex, []);
    grouped.get(queryIndex).push(match);
  }
  return grouped;
}

function mappingsFromMatches(fields, matches, extractionReport) {
  const grouped = groupMatchesByField(matches);

  return fields.map((field, index) => {
    const candidates = (grouped.get(index) || [])
      .map((candidate) => ({
        ...candidate,
        distance: Number(candidate.distance),
        confidence: confidenceFromDistance(
          candidate.distance,
          field,
          candidate,
          extractionReport.fieldReports[index]?.score || 0
        )
      }))
      .filter((candidate) => candidateCompatible(field, candidate))
      .sort((left, right) => right.confidence - left.confidence);

    const best = candidates[0];
    const runnerUp = candidates[1];
    const gap = best && runnerUp ? best.confidence - runnerUp.confidence : best?.confidence || 0;
    const isConfident = Boolean(best && best.confidence >= 0.62 && gap >= 0.015);

    return {
      field,
      mapping: isConfident
        ? {
            key: best.semantic_path,
            semanticPath: best.semantic_path,
            value: best.raw_value,
            confidence: best.confidence,
            method: "semantic-vector",
            reasons: [`Nearest semantic profile atom is ${best.semantic_path}`],
            reviewRequired: best.confidence < 0.78 || (runnerUp && gap < 0.05)
          }
        : null,
      candidates: candidates.slice(0, 3).map((candidate) => ({
        semanticPath: candidate.semantic_path,
        confidence: candidate.confidence,
        distance: candidate.distance
      }))
    };
  });
}

async function mapWithStoredProfile({ userId, embeddings }) {
  const maxDistance = Number(process.env.CURION_MAPPING_MAX_DISTANCE || DEFAULT_MAX_DISTANCE);
  const matchCount = Number(process.env.CURION_MAPPING_MATCH_COUNT || DEFAULT_MATCH_COUNT);

  return supabaseRpc("match_profile_atoms_batch", {
    p_user_id: userId,
    p_queries: embeddings,
    p_match_count: Number.isFinite(matchCount) ? matchCount : DEFAULT_MATCH_COUNT,
    p_max_distance: Number.isFinite(maxDistance) ? maxDistance : DEFAULT_MAX_DISTANCE
  });
}

function mapWithTransientProfile({ fields, fieldEmbeddings, profile, extractionReport }) {
  const atoms = profileAtomsFromProfile(profile);
  return batchEmbedTexts(
    atoms.map((atom) => atom.embeddingText),
    "RETRIEVAL_DOCUMENT"
  ).then((atomEmbeddings) => {
    const matches = [];
    fieldEmbeddings.forEach((fieldEmbedding, queryIndex) => {
      atoms.forEach((atom, atomIndex) => {
        const similarity = cosineSimilarity(fieldEmbedding, atomEmbeddings[atomIndex]);
        const distance = 1 - similarity;
        if (distance <= DEFAULT_MAX_DISTANCE) {
          matches.push({
            query_index: queryIndex,
            semantic_path: atom.semanticPath,
            raw_value: atom.rawValue,
            embedding_text: atom.embeddingText,
            distance
          });
        }
      });
    });

    const topMatches = [];
    for (let index = 0; index < fields.length; index += 1) {
      topMatches.push(
        ...matches
          .filter((match) => match.query_index === index)
          .sort((left, right) => left.distance - right.distance)
          .slice(0, DEFAULT_MATCH_COUNT)
      );
    }
    return mappingsFromMatches(fields, topMatches, extractionReport);
  });
}

function buildMappingConfidenceReport(mappings, extractionReport) {
  const fieldReports = mappings.map((entry) => {
    const extractionScore =
      extractionReport.fieldReports.find((fieldReport) => fieldReport.selector === entry.field.selector)?.score || 0;

    if (!entry.mapping) {
      return {
        label: entry.field.label,
        selector: entry.field.selector,
        score: clamp(0.25 + extractionScore * 0.2),
        extractionScore,
        method: "unmapped",
        reasons: [],
        weaknesses: ["No confident mapping was found"],
        candidateScores: (entry.candidates || []).map((candidate) => ({
          key: candidate.semanticPath,
          score: candidate.confidence
        })),
        shouldUseLLM: true
      };
    }

    const score = clamp(entry.mapping.confidence * 0.72 + extractionScore * 0.28);
    const shouldUseLLM = score < 0.75 || entry.mapping.reviewRequired;

    return {
      label: entry.field.label,
      selector: entry.field.selector,
      score,
      extractionScore,
      method: entry.mapping.method,
      mappedKey: entry.mapping.key,
      mappedValue: entry.mapping.value,
      reasons: entry.mapping.reasons || [],
      weaknesses: entry.mapping.reviewRequired ? ["Backend marked this field for review"] : [],
      candidateScores: (entry.candidates || []).map((candidate) => ({
        key: candidate.semanticPath,
        score: candidate.confidence
      })),
      shouldUseLLM
    };
  });

  const overallScore = clamp(
    fieldReports.reduce((sum, report) => sum + report.score, 0) / Math.max(fieldReports.length, 1)
  );
  const unresolvedCount = fieldReports.filter((report) => report.method === "unmapped").length;
  const lowConfidenceCount = fieldReports.filter((report) => report.shouldUseLLM).length;
  const reasons = [];

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
    unresolvedCount
  };
}

function summarize(mappings, extractionReport, source, warnings = []) {
  const mapped = mappings.filter((entry) => entry.mapping);
  const mappedCount = mapped.length;
  const mappingAverage =
    mapped.reduce((sum, entry) => sum + entry.mapping.confidence, 0) / Math.max(mappedCount, 1);
  const overallConfidence = clamp(mappingAverage * 0.76 + extractionReport.overallScore * 0.24);
  const mappingReport = buildMappingConfidenceReport(mappings, extractionReport);

  return {
    source,
    fieldCount: mappings.length,
    mappedCount,
    overallConfidence,
    reviewRequired:
      overallConfidence < 0.8 ||
      mappings.some((entry) => !entry.mapping || entry.mapping.reviewRequired),
    extractionReport,
    mappingReport,
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
    const userId = String(body.userId || "").trim();
    const fields = Array.isArray(body.fields) ? body.fields.map(sanitizeField) : [];
    const extractionReport = calculateExtractionConfidence(fields);

    if (fields.length === 0) {
      json(response, 200, summarize([], extractionReport, "semantic-vector", []));
      return;
    }

    const fieldTexts = fields.map((field) => embeddingTextForField(field, body));
    const fieldEmbeddings = await batchEmbedTexts(fieldTexts, "RETRIEVAL_QUERY");
    const warnings = [];
    let mappings;
    let source;

    if (userId) {
      const matches = await mapWithStoredProfile({
        userId,
        embeddings: fieldEmbeddings
      });
      mappings = mappingsFromMatches(fields, matches, extractionReport);
      source = "semantic-vector";
    } else if (body.profile && typeof body.profile === "object" && !Array.isArray(body.profile)) {
      mappings = await mapWithTransientProfile({
        fields,
        fieldEmbeddings,
        profile: body.profile,
        extractionReport
      });
      source = "semantic-vector-transient-profile";
      warnings.push("No userId was supplied; mapped against transient profile payload instead of Supabase atoms");
    } else {
      throw new Error("userId is required unless a transient profile object is supplied");
    }

    const llmResult = await applyLlmFallback(
      body,
      fields,
      mappings,
      source,
      userId,
      extractionReport,
      warnings
    );
    mappings = llmResult.mappings;
    source = llmResult.source;

    json(response, 200, summarize(mappings, extractionReport, source, warnings));
  } catch (error) {
    json(response, 400, {
      error: error.message || "Unable to map form"
    });
  }
}
