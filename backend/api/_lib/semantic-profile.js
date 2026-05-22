export const EMBEDDING_DIMENSION = 768;
export const DEFAULT_EMBEDDING_MODEL = "gemini-embedding-2";
export const MAX_BATCH_TEXTS = 96;

const STRUCTURAL_CONCEPTS = [
  {
    pattern: /(^|\.)first_?name$|(^|\.)given_?name$|(^|\.)forename$/i,
    concept: "First name, given name, personal identity entry."
  },
  {
    pattern: /(^|\.)last_?name$|(^|\.)family_?name$|(^|\.)surname$/i,
    concept: "Last name, surname, family name, personal identity entry."
  },
  {
    pattern: /(^|\.)full_?name$|(^|\.)name$/i,
    concept: "Full name, legal name, contact identity entry."
  },
  {
    pattern: /email|e_mail|mail/i,
    concept: "Email address, inbox, electronic contact detail."
  },
  {
    pattern: /phone|mobile|telephone|whatsapp|tel/i,
    concept: "Phone number, mobile number, telephone contact detail."
  },
  {
    pattern: /company|organization|organisation|employer|business/i,
    concept: "Company, organization, employer, business account."
  },
  {
    pattern: /job|title|role|position|designation/i,
    concept: "Job title, work role, position, designation."
  },
  {
    pattern: /address|street|line_?1|line_?2/i,
    concept: "Street address, mailing address, delivery address line."
  },
  {
    pattern: /city|town|locality/i,
    concept: "City, town, locality, address location."
  },
  {
    pattern: /state|province|region|territory/i,
    concept: "State, province, region, territory, address location."
  },
  {
    pattern: /postal|postcode|zip|pin/i,
    concept: "Postal code, ZIP code, postcode, delivery zone."
  },
  {
    pattern: /country|nation/i,
    concept: "Country, nation, residence country, address country."
  },
  {
    pattern: /linkedin/i,
    concept: "LinkedIn profile URL, professional profile link."
  },
  {
    pattern: /website|homepage|portfolio|site|url/i,
    concept: "Website URL, homepage, portfolio, web presence."
  },
  {
    pattern: /contact.*method|preferred.*contact|channel/i,
    concept: "Preferred contact method, communication channel, outreach preference."
  },
  {
    pattern: /terms|privacy|consent|agree|opt_?in|policy/i,
    concept: "Consent, terms agreement, privacy policy acceptance, opt-in."
  },
  {
    pattern: /note|message|comment|memo|about/i,
    concept: "Notes, message, comments, contextual freeform details."
  }
];

export function setCorsHeaders(response) {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
}

export function json(response, statusCode, payload) {
  setCorsHeaders(response);
  response.status(statusCode).json(payload);
}

function isBinaryBody(body) {
  return (
    (typeof Buffer !== "undefined" && Buffer.isBuffer(body)) ||
    body instanceof Uint8Array
  );
}

export function parseRequestBody(body) {
  if (body === undefined || body === null || body === "") {
    return {};
  }

  if (isPlainObject(body)) {
    return body;
  }

  const text = isBinaryBody(body)
    ? Buffer.from(body).toString("utf8")
    : String(body);

  if (!text.trim()) {
    return {};
  }

  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Request body must be valid JSON");
  }
}

export function clamp(value) {
  return Math.max(0, Math.min(1, value));
}

export function normalizeText(text) {
  return String(text || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function splitNameParts(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return {};
  if (parts.length === 1) return { firstName: parts[0] };
  return {
    firstName: parts.slice(0, -1).join(" "),
    lastName: parts[parts.length - 1]
  };
}

function pathSegmentLabel(segment) {
  return normalizeText(segment).replace(/\s+/g, " ");
}

export function semanticConceptForPath(path) {
  const normalizedPath = String(path || "").replace(/[A-Z]/g, (char) => `_${char.toLowerCase()}`);
  const normalizedLeaf = normalizedPath.split(".").pop() || normalizedPath;
  const leafMatch = STRUCTURAL_CONCEPTS.find((entry) => entry.pattern.test(normalizedLeaf));
  if (leafMatch) return leafMatch.concept;

  const pathMatch = STRUCTURAL_CONCEPTS.find((entry) => entry.pattern.test(normalizedPath));
  if (pathMatch) return pathMatch.concept;

  const tokens = String(path || "")
    .split(".")
    .map(pathSegmentLabel)
    .filter(Boolean)
    .join(", ");

  return tokens ? `Profile field described by path tokens: ${tokens}.` : "Generic user profile metadata field.";
}

export function embeddingTextForProfilePath(path) {
  return `User profile metadata field. Path: ${path}. Concept: ${semanticConceptForPath(path)}`;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function scalarToRawValue(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  return "";
}

export function flattenProfile(profile, prefix = "") {
  if (!isPlainObject(profile)) return [];

  const atoms = [];
  for (const [key, value] of Object.entries(profile)) {
    const path = prefix ? `${prefix}.${key}` : key;

    if (isPlainObject(value)) {
      atoms.push(...flattenProfile(value, path));
      continue;
    }

    if (Array.isArray(value)) {
      const rawValue = value
        .filter((item) => item !== undefined && item !== null && typeof item !== "object")
        .map(String)
        .map((item) => item.trim())
        .filter(Boolean)
        .join(", ");
      if (rawValue) atoms.push({ semanticPath: path, rawValue });
      continue;
    }

    const rawValue = scalarToRawValue(value);
    if (rawValue) atoms.push({ semanticPath: path, rawValue });
  }

  return atoms;
}

function addDerivedNameAtoms(atoms) {
  const existingPaths = new Set(atoms.map((atom) => atom.semanticPath));
  const derivedAtoms = [];

  for (const atom of atoms) {
    const lastSegment = atom.semanticPath.split(".").pop() || "";
    if (!/^(name|fullName|full_name)$/i.test(lastSegment)) continue;

    const { firstName, lastName } = splitNameParts(atom.rawValue);
    const prefix = atom.semanticPath.includes(".")
      ? atom.semanticPath.split(".").slice(0, -1).join(".")
      : "";
    const firstNamePath = prefix ? `${prefix}.firstName` : "firstName";
    const lastNamePath = prefix ? `${prefix}.lastName` : "lastName";

    if (firstName && !existingPaths.has(firstNamePath)) {
      derivedAtoms.push({ semanticPath: firstNamePath, rawValue: firstName });
      existingPaths.add(firstNamePath);
    }

    if (lastName && !existingPaths.has(lastNamePath)) {
      derivedAtoms.push({ semanticPath: lastNamePath, rawValue: lastName });
      existingPaths.add(lastNamePath);
    }
  }

  return [...atoms, ...derivedAtoms];
}

export function profileAtomsFromProfile(profile) {
  return addDerivedNameAtoms(flattenProfile(profile)).map((atom) => ({
    semanticPath: atom.semanticPath,
    rawValue: atom.rawValue,
    embeddingText: embeddingTextForProfilePath(atom.semanticPath)
  }));
}

export function normalizeVector(values) {
  const vector = Array.from(values || [])
    .slice(0, EMBEDDING_DIMENSION)
    .map((value) => {
      const number = Number(value);
      return Number.isFinite(number) ? number : 0;
    });

  while (vector.length < EMBEDDING_DIMENSION) vector.push(0);

  const magnitude = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (!magnitude) return vector;
  return vector.map((value) => value / magnitude);
}

function geminiApiKey() {
  return process.env.GEMINI_API_KEY || process.env.gemini_api_key;
}

export function embeddingModel() {
  return process.env.GEMINI_EMBEDDING_MODEL || process.env.gemini_embedding_model || DEFAULT_EMBEDDING_MODEL;
}

export async function batchEmbedTexts(texts, taskType = "RETRIEVAL_DOCUMENT") {
  if (!Array.isArray(texts) || texts.length === 0) return [];
  if (texts.length > MAX_BATCH_TEXTS) {
    throw new Error(`Too many embedding inputs: ${texts.length}. Limit is ${MAX_BATCH_TEXTS} per serverless request.`);
  }

  const apiKey = geminiApiKey();
  if (!apiKey || typeof fetch !== "function") {
    throw new Error("GEMINI_API_KEY is not configured");
  }

  const model = embeddingModel();
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": apiKey
    },
    body: JSON.stringify({
      requests: texts.map((text) => ({
        model: `models/${model}`,
        content: {
          parts: [{ text: String(text || "") }]
        },
        taskType,
        outputDimensionality: EMBEDDING_DIMENSION
      }))
    })
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Gemini embedding request failed with status ${response.status}${detail ? `: ${detail}` : ""}`);
  }

  const result = await response.json();
  const embeddings = result.embeddings || [];
  if (embeddings.length !== texts.length) {
    throw new Error(`Gemini returned ${embeddings.length} embeddings for ${texts.length} inputs`);
  }

  return embeddings.map((embedding) => normalizeVector(embedding.values));
}

function supabaseUrl() {
  return (process.env.SUPABASE_URL || process.env.supabase_url || "").replace(/\/$/, "");
}

function supabaseKey() {
  return (
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_SERVICE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.supabase_service_role_key ||
    process.env.supabase_anon_key ||
    ""
  );
}

export function assertSupabaseConfigured() {
  if (!supabaseUrl() || !supabaseKey()) {
    throw new Error("Supabase URL and service key are not configured");
  }
}

export async function supabaseRpc(functionName, payload) {
  assertSupabaseConfigured();
  const key = supabaseKey();
  const response = await fetch(`${supabaseUrl()}/rest/v1/rpc/${functionName}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`
    },
    body: JSON.stringify(payload)
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Supabase RPC ${functionName} failed with status ${response.status}${detail ? `: ${detail}` : ""}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

export async function supabaseSelectRows(tableName, query = {}) {
  assertSupabaseConfigured();
  const key = supabaseKey();
  const url = new URL(`${supabaseUrl()}/rest/v1/${encodeURIComponent(tableName)}`);

  for (const [name, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    url.searchParams.set(name, String(value));
  }

  const response = await fetch(url, {
    method: "GET",
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Supabase table select ${tableName} failed with status ${response.status}${detail ? `: ${detail}` : ""}`);
  }

  return response.json();
}

export function cosineSimilarity(left, right) {
  const length = Math.min(left?.length || 0, right?.length || 0);
  if (!length) return 0;
  let sum = 0;
  for (let index = 0; index < length; index += 1) {
    sum += left[index] * right[index];
  }
  return clamp(sum);
}
