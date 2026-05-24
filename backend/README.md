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
2. Profile atoms are matched semantically from Supabase when `userId` is supplied, or from the transient `profile` payload for local demos.
3. Low-confidence or unmapped fields are sent to Gemini as an LLM fallback and resolved back to stored profile atoms.
4. Vision fallback is intentionally not implemented yet.

## Environment Variables

Set these in Vercel:

- `GEMINI_API_KEY`
- `GEMINI_EMBEDDING_MODEL` optional, defaults to `gemini-embedding-2`
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

Then paste the deployed endpoint into the Curion extension options page:

```text
https://backend-three-mu-84.vercel.app/api/agent/map-form
```
