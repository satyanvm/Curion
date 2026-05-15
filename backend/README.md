# Curion Agent API

Deploy this folder as the backend API for the Curion extension.

## Endpoint

`POST /api/agent/map-form`

Request body:

```json
{
  "goal": "Fill this form",
  "url": "https://example.com/form",
  "title": "Example Form",
  "html": "<html>...</html>",
  "fields": [],
  "profile": {}
}
```

Response body:

```json
{
  "source": "llm",
  "fieldCount": 4,
  "mappedCount": 3,
  "overallConfidence": 0.84,
  "reviewRequired": false,
  "mappings": []
}
```

## Environment Variables

Set these in Vercel:

- `GEMINI_API_KEY`
- `GEMINI_MODEL` optional, defaults to `gemini-2.5-flash`

If Gemini is not configured, the API still returns deterministic mappings.

## Deploy

From this `backend` folder:

```bash
npx vercel --prod
```

Then paste the deployed endpoint into the Curion extension options page:

```text
https://backend-three-mu-84.vercel.app/api/agent/map-form
```
