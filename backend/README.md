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

This endpoint flattens nested profile metadata into semantic atoms, embeds only structural descriptors with `gemini-embedding-2`, and stores the raw value separately in Supabase.

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
  "source": "semantic-vector",
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
- `GEMINI_EMBEDDING_MODEL` optional, defaults to `gemini-embedding-2`
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `CURION_MAPPING_MAX_DISTANCE` optional, defaults to `0.42`
- `CURION_MAPPING_MATCH_COUNT` optional, defaults to `5`

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
