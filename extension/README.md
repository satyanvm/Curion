# Curion Chrome Extension

Manifest V3 extension that scans forms, maps visible fields to saved metadata, fills matched values, and can clear filled fields again.

Frontend site: `https://curion.sbs`

## How Users Provide Metadata

Curion uses a saved backend profile plus optional per-form context. The extension has two metadata layers:

1. `curionProfile`: default saved profile metadata, mirrored to backend profile atoms when saved.
2. `curionWorkingMetadata`: temporary working JSON that overrides the default profile when any value is present.

### Individual Users: Extension Metadata

Open **Curion -> Extension options**.

- Edit default metadata in the form UI and click **Save profile**. Curion saves it to the backend and selects **Use saved profile** by default.
- Paste default metadata into **Profile JSON** and click **Save JSON** to save that profile to the backend.
- Paste temporary JSON into **Current working metadata**, then click **Use working JSON** when you want that JSON to override the saved profile.
- The working JSON editor starts empty so you can paste a fresh payload directly.
- Clear working metadata to fall back to the saved profile.
- Enable **Curion scanning and form filling**.
- Choose **Ask for review before submit** or **Directly submit after filling**.
- Import/export JSON for backup or migration.

This is the right model for personal profiles, solo workflows, and quick demos because the saved profile is explicit and the working JSON override remains temporary.

### Businesses: API Metadata

Business metadata should usually come from APIs instead of manual extension JSON. A company app can store canonical customer, lead, candidate, employee, or vendor records in its backend, then send only the scoped record needed for the current workflow to the mapping API or extension.

Use APIs when you need:

- Team permissions and SSO.
- Audit logs for who filled what.
- CRM, ATS, HRIS, or support-system sync.
- Centralized updates and revocation.
- Per-workflow metadata, such as a selected lead instead of the user's personal profile.

Keep the extension JSON path for individuals. Use API-fed metadata for business workflows where the source of truth lives in company systems.

## Profile Fields

| Key | Purpose |
|-----|---------|
| `name` | Full name |
| `email` | Email address |
| `phone` | Phone number |
| `company` | Company or organization |
| `jobTitle` | Role or title |
| `address` | Street address |
| `city` | City |
| `state` | State or province |
| `postalCode` | ZIP / postal code |
| `country` | Country |
| `linkedin` | LinkedIn URL |
| `website` | Website URL |
| `preferredContactMethod` | Preferred channel |
| `notes` | Freeform notes |
| `acceptTerms` | Checkbox value, such as `yes` |

## Workflow

1. Load unpacked extension from this folder in `chrome://extensions`.
2. Save default metadata in options or paste working metadata JSON.
3. Open a form page.
4. Enable Curion scanning and form filling in options.
5. When Curion detects a form, it sends the DOM snapshot to the backend mapping API.
6. Use the popup to scan, fill, or unfill visible controls manually.

For local `file://` HTML form tests, open `chrome://extensions`, expand Curion details, and enable **Allow access to file URLs**. Chrome blocks content scripts on local files until that switch is enabled.

The extension uses the deployed backend endpoint as the fixed mapping pipeline. The content script extracts DOM fields and fills returned mappings; semantic matching and LLM fallback happen in `POST /api/agent/map-form`.

## Backend API

Default endpoint:

```text
https://backend-three-mu-84.vercel.app/api/agent/map-form
```

The popup sends `userId`, `fields`, `html`, `goal`, and page context when **Saved profile** is active, which makes the backend query stored Supabase vector atoms. If **Working JSON** is active, it sends the transient `profile` payload instead. The backend then runs semantic matching first and Gemini fallback only for low-confidence/unmapped fields. See `backend/README.md`.

## Files

| File | Role |
|------|------|
| `profileSchema.ts` | Shared profile keys, sample data, sanitization |
| `options.html` / `options.ts` | Default metadata, working JSON, and behavior settings |
| `popup.html` / `popup.ts` | Scan, review, fill, unfill |
| `contentScript.ts` | DOM extraction, backend mapping calls, auto-fill, unfill, direct submit |
