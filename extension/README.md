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

## Local Install

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select this `extension` folder.
5. Open the Curion options page and save profile data.
6. Visit a form page, open Curion, scan, then fill matched fields.

## Current Behavior

The extension runs local deterministic matching in `contentScript.js`. It does not call Gemini yet. The next step is to connect the popup to the Node agent/backend so the extension can use the full extraction confidence, HTML adequacy, rich LLM repair, mapping confidence, and review workflow.
