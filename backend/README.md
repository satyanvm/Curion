# Curion Agent API

Deploy this folder as the backend API for the Curion extension.

## Endpoints

`POST /api/profile/ingest`

Request body:

```json
{
  "userId": "user_123",
  "profile": {
    "shipping": {
      "firstName": "Ada",
      "city": "London"
    }
  }
}
```

This endpoint flattens nested profile metadata into semantic atoms, embeds only structural descriptors with `gemini-embedding-2`, and stores the raw value separately in Supabase. Derived name atoms use the same `firstName` / `lastName` path shape everywhere.

`GET /api/extension/download`

Serves the current Curion extension ZIP package as a download. By default it fetches:

```text
https://curion.sbs/curion-extension.zip
```

Set `CURION_EXTENSION_DOWNLOAD_URL` in Vercel if the package moves to a different host or file name.

`POST /api/agent/map-form`

Request body:

```json
{
  "userId": "user_123",
  "goal": "Fill this form",
  "url": "https://example.com/form",
  "title": "Example Form",
  "html": "<html>...</html>",
  "fields": [
    { "id": "f1", "label": "First Name", "name": "fname", "type": "text", "placeholder": "" }
  ]
}
```

Response body:

```json
{
  "source": "semantic-vector+llm",
  "fieldCount": 4,
  "mappedCount": 3,
  "overallConfidence": 0.84,
  "reviewRequired": false,
  "mappingReport": {},
  "mappings": []
}
```

The mapping endpoint is the single mapping pipeline used by the extension and CLI test runner:

1. DOM-extracted fields are embedded as retrieval queries.
2. If extraction confidence falls below `0.68`, the configured LLM repairs the field extraction from submitted HTML. If `screenshotDataUrl` and an OpenAI key are provided, the repair can also use vision to recover labels that are visible but not exposed in the DOM. The backend merges repaired fields and recalculates confidence.
3. Profile atoms are matched semantically from Supabase when `userId` is supplied, or from the transient `profile` payload for local demos.
4. Low-confidence or unmapped mappings are sent to the configured LLM fallback and resolved back to stored profile atoms.
5. If Gemini embeddings are unavailable but an LLM fallback key and transient `profile` payload are supplied, the endpoint can continue with an LLM-only mapping path.

## Environment Variables

Set these in Vercel:

- `GEMINI_API_KEY`
- `GEMINI_EMBEDDING_MODEL` optional, defaults to `gemini-embedding-2`
- `OPENAI_API_KEY` optional fallback key for JSON/vision LLM repair
- `BASE_URL` optional OpenAI-compatible API base URL; accepts either provider root, `/v1`, or `/v1/chat/completions`
- `OPENAI_MODEL` optional, defaults to `gpt-4.1-mini`
- `OPENAI_VISION_MODEL` optional, defaults to `OPENAI_MODEL` or `gpt-4.1-mini`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CURION_MAPPING_MAX_DISTANCE` optional, defaults to `0.42`
- `CURION_MAPPING_MATCH_COUNT` optional, defaults to `5`
- `CURION_EXTENSION_DOWNLOAD_URL` optional, defaults to `https://curion.sbs/curion-extension.zip`

Run [backend/sql/profile_atoms.sql](/Users/satyanarayan/projects/Automation_bot_form_filling/project/backend/sql/profile_atoms.sql) in the Supabase SQL editor before deploying.

## Deploy

From this `backend` folder:

```bash
npx vercel --prod
```

The Curion extension is pinned to the deployed mapping endpoint:

```text
https://backend-three-mu-84.vercel.app/api/agent/map-form
```
