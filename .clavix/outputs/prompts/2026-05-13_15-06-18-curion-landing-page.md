# Optimized Prompt: Curion Landing Page Frontend

Objective:
Build a modern, premium landing page frontend for Curion, an AI agent that automatically fills forms using previously provided user context and data. All frontend code must be created inside the existing `frontend/` folder.

Product Positioning:
Curion is most likely delivered as a browser extension. The landing page should make downloading the extension the primary conversion goal and viewing a demo the secondary action.

Design Direction:
- Premium minimal aesthetic inspired by Cal.com, Linear, and Vercel.
- Black, white, and gray visual system only.
- Developer-tool aesthetic: crisp typography, restrained surfaces, precise spacing, clean hierarchy.
- Avoid generic AI SaaS visuals, purple gradients, glassmorphism, bokeh/orb decoration, and overly illustrative marketing sections.
- Use subtle, purposeful animations only, such as small hover transitions, restrained reveal motion, or lightweight preview interaction.
- Keep border radii modest, ideally 8px or less unless the existing frontend design system already uses another standard.
- Use clean typography and strong contrast.
- Make the product name `Curion` a first-viewport signal.

Required Sections:
1. Hero
   - Product name: `Curion`
   - Tagline focused on automated AI form filling using saved user context.
   - Primary CTA: `Download Extension`
   - Secondary CTA: `View Demo`
   - Include a refined product-oriented visual signal in the first viewport, such as a browser-extension/form autofill mockup rather than abstract AI artwork.

2. Features
   - Automatic form filling
   - Context-aware autofill
   - Time saving
   - Secure local data usage
   - Present features in a compact, scannable layout that feels like a developer tool, not a generic SaaS card wall.

3. How It Works
   - Save your data once
   - AI detects forms
   - Automatically fills forms intelligently
   - Use clear step progression and concise copy.

4. Extension Preview / Mockup
   - Show a realistic browser-extension or form-filling preview.
   - The mockup should visually communicate saved user context being used to complete form fields.
   - Avoid fake dashboards that do not relate directly to extension-based form filling.

5. Footer
   - Include: `Made with love by Satya Narayan Verma`
   - Include Twitter link
   - Include LinkedIn link

Implementation Constraints:
- Work only in the `frontend/` folder.
- Use the existing frontend stack and conventions if present; inspect the folder before editing.
- If the frontend is empty, choose a simple modern setup consistent with the repository, such as Vite + React, unless the project already implies another framework.
- Keep the page responsive across mobile, tablet, and desktop.
- Ensure text never overlaps, overflows buttons, or becomes illegible at small widths.
- Do not create a marketing-only placeholder. Build the actual landing page experience as the first screen.
- Avoid adding unnecessary dependencies. Use existing libraries when available.
- Use semantic HTML and accessible button/link states.
- CTA buttons should be clear and polished:
  - `Download Extension` should be visually primary.
  - `View Demo` should be secondary.
- Footer social links should be usable links. If exact URLs are not available in the project or prompt, use reasonable placeholders and make them easy to replace.

Content Tone:
- Confident, concise, technical, and polished.
- No hype-heavy AI language.
- Emphasize control, speed, privacy, and the extension workflow.

Suggested Copy Direction:
- Hero tagline example: `Curion fills forms for you using the context you have already saved, so every repetitive field becomes one click closer to done.`
- Feature copy should be short and specific.
- Avoid phrases like `revolutionary AI`, `10x your productivity`, or generic `powered by AI` claims.

Visual Mockup Requirements:
- Include a browser window or extension panel preview with form fields such as name, email, company, address, or application details.
- Show selected fields being filled or confirmed.
- Keep the preview monochrome and precise.
- Use small labels, borders, checkmarks, cursor/fill states, or compact status indicators rather than colorful decorative effects.

Validation Checklist:
- Landing page renders successfully from the frontend app.
- Responsive layout works at common widths: 375px, 768px, 1440px.
- No purple gradients, glassmorphism, or generic AI illustration tropes are present.
- Hero includes product name, tagline, both CTA buttons, and an extension/form mockup.
- All required sections are present.
- Footer includes the required credit and social links.
- Animations are subtle and do not interfere with readability.
- Text fits within buttons, cards, and mockup elements on mobile and desktop.

Expected Output:
- Production-quality frontend implementation in `frontend/`.
- A brief summary of changed files.
- Verification steps performed, including any build/lint/test commands run.
