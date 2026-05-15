# Curion Chrome Extension

This is the first Manifest V3 extension shell for Curion.

## How The User Provides Profile Data

Users open the extension options page and save reusable profile data. The data is stored in `chrome.storage.local` under `curionProfile`.

Supported fields currently match the core profile shape:

- `name`
- `email`
- `phone`
- `company`
- `jobTitle`
- `address`
- `city`
- `state`
- `postalCode`
- `country`
- `linkedin`
- `website`
- `preferredContactMethod`
- `notes`
- `acceptTerms`

The options page supports both form editing and raw JSON editing so advanced users can paste structured data directly.

The backend API URL is also editable in options. It defaults to:

```text
https://backend-three-mu-84.vercel.app/api/agent/map-form
```

## Local Install

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this `extension` folder.
5. Open the Curion options page and save profile data.
6. Visit a form page, open Curion, scan, then fill matched fields.

## Current Behavior

The extension collects the active page fields and HTML, calls the Curion backend API, reviews returned mappings in the popup, then fills the approved backend mappings into the current page. If the backend API URL is empty or unavailable, the extension can still use its local deterministic matching fallback.
