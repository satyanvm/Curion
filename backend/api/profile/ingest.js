import {
  batchEmbedTexts,
  json,
  profileAtomsFromProfile,
  parseRequestBody,
  setCorsHeaders,
  supabaseRpc
} from "../_lib/semantic-profile.js";

function validatePayload(body) {
  const userId = String(body?.userId || "").trim();
  if (!userId) throw new Error("userId is required");
  if (!body?.profile || typeof body.profile !== "object" || Array.isArray(body.profile)) {
    throw new Error("profile object is required");
  }
  return { userId, profile: body.profile };
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
    const { userId, profile } = validatePayload(parseRequestBody(request.body));
    const atoms = profileAtomsFromProfile(profile);
    const embeddings = await batchEmbedTexts(
      atoms.map((atom) => atom.embeddingText),
      "RETRIEVAL_DOCUMENT"
    );

    const rows = atoms.map((atom, index) => ({
      semantic_path: atom.semanticPath,
      raw_value: atom.rawValue,
      embedding_text: atom.embeddingText,
      embedding: embeddings[index]
    }));

    const result = await supabaseRpc("replace_profile_atoms", {
      p_user_id: userId,
      p_atoms: rows
    });

    json(response, 200, {
      source: "semantic-profile-ingest",
      userId,
      atomCount: rows.length,
      result: Array.isArray(result) ? result[0] : result
    });
  } catch (error) {
    json(response, 400, {
      error: error.message || "Unable to ingest profile"
    });
  }
}
