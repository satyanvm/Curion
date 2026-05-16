# Curion Chrome Extension

Manifest V3 extension that scans forms, maps visible fields to saved metadata, fills matched values, and can clear filled fields again.

Frontend site: `https://frontend-six-omega-77.vercel.app`

## How Users Provide Metadata

Curion uses a fixed profile object plus optional per-form context. The extension now has two metadata layers:

1. `curionProfile`: default saved profile metadata.
2. `curionWorkingMetadata`: temporary working JSON that overrides the default profile when any value is present.

### Individual Users: Extension Metadata

Open **Curion -> Extension options**.

- Edit default metadata in the form UI.
- Paste default metadata into **Profile JSON** and click **Save JSON**.
- Paste temporary JSON into **Current working metadata** and click **Use working JSON**.
- Clear working metadata to fall back to the saved profile.
- Enable **Curion scanning and form filling**.
- Choose **Ask for review before submit** or **Directly submit after filling**.
- Import/export JSON for backup or migration.

This is the right model for personal profiles, solo workflows, and quick demos because the user owns the JSON locally in Chrome extension storage.

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
5. When Curion detects a form, use the on-page **Auto-fill** prompt to fill the mapped fields.
6. Use the popup to scan, fill, or unfill visible controls manually.

For local `file://` HTML form tests, open `chrome://extensions`, expand Curion details, and enable **Allow access to file URLs**. Chrome blocks content scripts on local files until that switch is enabled.

If the backend API URL is empty or unavailable, the popup falls back to deterministic local matching in the content script.

## Backend API

Default endpoint:

```text
https://backend-three-mu-84.vercel.app/api/agent/map-form
```

The popup sends `profile`, `fields`, `html`, `goal`, and `formContext`. See `backend/README.md`.

## Files

| File | Role |
|------|------|
| `profileSchema.js` | Shared profile keys, sample data, sanitization |
| `options.html` / `options.js` | Default metadata, working JSON, API URL, and behavior settings |
| `popup.html` / `popup.js` | Scan, review, fill, unfill |
| `contentScript.js` | DOM extraction, local matching, auto-fill, unfill, direct submit |
| `background.js` | Receives profile imports from the web setup page |
