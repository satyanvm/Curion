const PROFILE_SCHEMA = {
  name: ["full name", "your name", "contact name", "applicant", "candidate", "primary contact"],
  email: ["email", "e-mail", "inbox", "mail"],
  phone: ["phone", "mobile", "telephone", "tel", "line", "whatsapp"],
  company: ["company", "organization", "organisation", "employer", "account"],
  jobTitle: ["job title", "role", "designation", "position", "seat", "title"],
  address: ["address", "street", "base", "mailing"],
  city: ["city", "town", "market", "locality"],
  state: ["state", "province", "region", "territory"],
  postalCode: ["zip", "postal", "postcode", "pin", "zone"],
  country: ["country", "nation", "geo"],
  linkedin: ["linkedin", "profile"],
  website: ["website", "portfolio", "homepage", "source", "site"],
  preferredContactMethod: ["preferred contact", "contact method", "reach", "next touch", "channel"],
  notes: ["notes", "message", "comments", "context", "additional info"],
  acceptTerms: ["terms", "privacy", "agree", "consent", "ok to proceed"]
};

function normalize(text) {
  return String(text || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function containsAny(text, terms) {
  const normalized = normalize(text);
  const tokens = normalized.split(" ");
  return terms.some((term) => {
    const normalizedTerm = normalize(term);
    return normalizedTerm.includes(" ")
      ? normalized.includes(normalizedTerm)
      : tokens.includes(normalizedTerm);
  });
}

function labelizeKey(key) {
  return String(key || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ");
}

function metadataEntries(metadata, prefix = "") {
  if (!metadata || typeof metadata !== "object") return [];

  return Object.entries(metadata).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return metadataEntries(value, path);
    }
    if (value === undefined || value === null || value === "") return [];
    return [{
      key: path,
      label: labelizeKey(path),
      value: Array.isArray(value) ? value.join(", ") : String(value)
    }];
  });
}

function profileSchemaKeyForEntry(entry) {
  const segments = String(entry.key || "").split(".");
  const lastSegment = segments[segments.length - 1];
  return Object.prototype.hasOwnProperty.call(PROFILE_SCHEMA, lastSegment) ? lastSegment : "";
}

function profileCandidates(profile) {
  return metadataEntries(profile).map((entry) => {
    const schemaKey = profileSchemaKeyForEntry(entry);
    return {
      ...entry,
      schemaKey,
      aliases: Array.from(new Set([
        entry.key,
        entry.label,
        schemaKey,
        ...(schemaKey ? PROFILE_SCHEMA[schemaKey] : [])
      ].filter(Boolean)))
    };
  });
}

function cssPath(element) {
  if (element.id) {
    return `#${CSS.escape(element.id)}`;
  }

  const name = element.getAttribute("name");
  if (name) {
    return `${element.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
  }

  const parts = [];
  let current = element;
  while (current && current.nodeType === Node.ELEMENT_NODE && parts.length < 5) {
    let part = current.tagName.toLowerCase();
    const parent = current.parentElement;
    if (!parent) break;

    const siblings = Array.from(parent.children).filter((child) => child.tagName === current.tagName);
    if (siblings.length > 1) {
      part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
    }

    parts.unshift(part);
    current = parent;
  }

  return parts.join(" > ");
}

function labelFor(control) {
  const explicitLabel = control.id
    ? document.querySelector(`label[for="${CSS.escape(control.id)}"]`)
    : null;
  const parentLabel = control.closest("label");
  const ariaLabel = control.getAttribute("aria-label");
  const labelledBy = control.getAttribute("aria-labelledby");
  const labelledByText = labelledBy
    ? labelledBy
        .split(/\s+/)
        .map((id) => document.getElementById(id)?.textContent || "")
        .join(" ")
    : "";

  return (
    explicitLabel?.textContent ||
    parentLabel?.textContent ||
    ariaLabel ||
    labelledByText ||
    control.getAttribute("placeholder") ||
    control.getAttribute("name") ||
    control.id ||
    "Unnamed field"
  )
    .replace(/\s+/g, " ")
    .trim();
}

function getControls() {
  return Array.from(document.querySelectorAll("input, textarea, select")).filter((control) => {
    const type = (control.getAttribute("type") || "").toLowerCase();
    if (["hidden", "submit", "button", "reset", "file", "image"].includes(type)) return false;
    const style = window.getComputedStyle(control);
    return style.display !== "none" && style.visibility !== "hidden" && !control.disabled;
  });
}

function extractFields() {
  return getControls().map((control, index) => ({
    index,
    label: labelFor(control),
    selector: cssPath(control),
    type: control.tagName.toLowerCase() === "textarea"
      ? "textarea"
      : control.tagName.toLowerCase() === "select"
        ? "select"
        : (control.getAttribute("type") || "text").toLowerCase(),
    name: control.getAttribute("name") || "",
    placeholder: control.getAttribute("placeholder") || "",
    options: control.tagName.toLowerCase() === "select"
      ? Array.from(control.options).map((option) => option.textContent.trim()).filter(Boolean)
      : []
  }));
}

function fieldText(field) {
  return normalize([field.label, field.name, field.placeholder, field.type].join(" "));
}

function isEmailField(field) {
  const text = fieldText(field);
  return field.type === "email" || /(^| )(email|e mail)( |$)/.test(text);
}

function isPhoneField(field) {
  const text = fieldText(field);
  return field.type === "tel" || /(^| )(phone|mobile|telephone|tel)( |$)/.test(text);
}

function isUrlField(field) {
  const text = fieldText(field);
  return field.type === "url" || /(^| )(linkedin|website|portfolio|homepage|url)( |$)/.test(text);
}

function isSelectField(field) {
  return field.type === "select";
}

function keyLooksLike(key, expected) {
  return normalize(labelizeKey(key)).split(" ").includes(expected);
}

function isEmailValue(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || "").trim());
}

function mappingCompatibleWithField(field, mapping) {
  if (!mapping?.value) return false;

  if (isEmailField(field)) {
    return keyLooksLike(mapping.key, "email") && isEmailValue(mapping.value);
  }

  if (isPhoneField(field)) {
    return keyLooksLike(mapping.key, "phone") || keyLooksLike(mapping.key, "tel") || keyLooksLike(mapping.key, "mobile");
  }

  if (isUrlField(field)) {
    return keyLooksLike(mapping.key, "linkedin") || keyLooksLike(mapping.key, "website") || keyLooksLike(mapping.key, "url");
  }

  return true;
}

function mappingFromCandidate(field, candidate, confidence, method) {
  const mapping = {
    key: candidate.key,
    value: String(candidate.value),
    confidence,
    method
  };
  return mappingCompatibleWithField(field, mapping) ? mapping : null;
}

function ruleBasedValueForField(field, candidates) {
  const haystack = normalize([field.label, field.name, field.placeholder].join(" "));
  const relationalNameTerms = ["mother", "father", "parent", "guardian", "spouse", "wife", "husband"];
  let bestCandidate = null;
  let bestKey = "";
  let bestScore = 0;

  for (const [key, hints] of Object.entries(PROFILE_SCHEMA)) {
    const score = hints.reduce((total, hint) => {
      return total + (haystack.includes(normalize(hint)) ? 1 : 0);
    }, 0);
    const candidate = candidates.find((entry) => entry.schemaKey === key || entry.key === key);

    if (score > bestScore && candidate) {
      bestKey = key;
      bestCandidate = candidate;
      bestScore = score;
    }
  }

  if (!bestKey) {
    for (const entry of candidates) {
      if (
        containsAny(haystack, relationalNameTerms) &&
        normalize(entry.label).split(" ").includes("name") &&
        !containsAny(entry.label, relationalNameTerms)
      ) {
        continue;
      }

      const keyScore = normalize(entry.label)
        .split(" ")
        .filter((token) => token.length > 1 && haystack.includes(token)).length;

      if (keyScore > bestScore) {
        bestKey = entry.key;
        bestCandidate = entry;
        bestScore = keyScore;
      }
    }
  }

  if (!bestCandidate) return null;
  if (
    bestKey === "name" &&
    containsAny(haystack, relationalNameTerms) &&
    !containsAny(labelizeKey(bestKey), relationalNameTerms)
  ) {
    return null;
  }

  return mappingFromCandidate(field, bestCandidate, Math.min(0.96, 0.62 + bestScore * 0.12), "rule");
}

function tokenOverlapScore(fieldTokens, aliasTokens) {
  if (!fieldTokens.length || !aliasTokens.length) return 0;
  const overlapCount = aliasTokens.filter((token) => fieldTokens.includes(token)).length;
  return overlapCount ? overlapCount / aliasTokens.length : 0;
}

function typeCompatibilityBoost(field, candidate) {
  if (isEmailField(field) && candidate.schemaKey === "email") return 0.45;
  if (isPhoneField(field) && candidate.schemaKey === "phone") return 0.45;
  if (isUrlField(field) && ["linkedin", "website"].includes(candidate.schemaKey)) return 0.35;
  if (isSelectField(field) && ["country", "preferredContactMethod"].includes(candidate.schemaKey)) return 0.25;
  return 0;
}

function optionBoost(field, candidate) {
  if (!isSelectField(field) || !field.options?.length) return 0;
  return field.options.some((option) => normalize(option) === normalize(candidate.value)) ? 0.35 : 0;
}

function semanticScoreCandidate(field, candidate) {
  const compatibleMapping = mappingCompatibleWithField(field, candidate);
  if (!compatibleMapping) return 0;

  const fieldMeaning = normalize([
    field.label,
    field.name,
    field.placeholder,
    field.type,
    ...(field.options || [])
  ].join(" "));
  const fieldTokens = fieldMeaning.split(" ").filter(Boolean);
  let score = 0;

  for (const alias of candidate.aliases) {
    const normalizedAlias = normalize(alias);
    if (!normalizedAlias) continue;

    if (fieldMeaning === normalizedAlias) {
      score = Math.max(score, 0.95);
      continue;
    }

    if (fieldMeaning.includes(normalizedAlias)) {
      score = Math.max(score, normalizedAlias.includes(" ") ? 0.88 : 0.76);
    }

    score = Math.max(
      score,
      0.7 * tokenOverlapScore(fieldTokens, normalizedAlias.split(" ").filter(Boolean))
    );
  }

  return Math.max(0, Math.min(1, score + typeCompatibilityBoost(field, candidate) + optionBoost(field, candidate)));
}

function semanticValueForField(field, candidates) {
  const ranked = candidates
    .map((candidate) => ({
      candidate,
      score: semanticScoreCandidate(field, candidate)
    }))
    .sort((left, right) => right.score - left.score);
  const best = ranked[0];
  const runnerUp = ranked[1];

  if (!best || best.score < 0.82) return null;
  const gap = runnerUp ? best.score - runnerUp.score : best.score;
  if (gap < 0.12) return null;

  return mappingFromCandidate(field, best.candidate, Math.min(0.96, best.score), "semantic");
}

function profileValueForField(field, candidates) {
  const ruleMapping = ruleBasedValueForField(field, candidates);
  if (ruleMapping?.confidence >= 0.82) return ruleMapping;
  return semanticValueForField(field, candidates) || ruleMapping;
}

function analyze(profile) {
  const fields = extractFields();
  const candidates = profileCandidates(profile);
  const mappings = fields.map((field) => ({
    field,
    mapping: profileValueForField(field, candidates)
  }));

  const mappedCount = mappings.filter((entry) => entry.mapping).length;
  return {
    url: window.location.href,
    title: document.title,
    fieldCount: fields.length,
    mappedCount,
    mappings
  };
}

function hasProfile(profile) {
  return metadataEntries(profile).length > 0;
}

function activeProfileFromSettings(settings) {
  return hasProfile(settings.curionWorkingMetadata)
    ? settings.curionWorkingMetadata
    : settings.curionProfile || {};
}

function collectPageSnapshot() {
  const fields = extractFields();
  return {
    url: window.location.href,
    title: document.title,
    html: document.documentElement.outerHTML,
    fields,
    fieldCount: fields.length
  };
}

function setNativeValue(element, value) {
  const prototype = Object.getPrototypeOf(element);
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");
  if (descriptor?.set) {
    descriptor.set.call(element, value);
  } else {
    element.value = value;
  }
}

function fillControl(control, value) {
  const tag = control.tagName.toLowerCase();
  const type = (control.getAttribute("type") || "").toLowerCase();

  if (type === "checkbox" || type === "radio") {
    const normalizedValue = normalize(value);
    control.checked = ["yes", "true", "1", "agree", "accepted"].includes(normalizedValue);
  } else if (tag === "select") {
    const options = Array.from(control.options);
    const match = options.find((option) => {
      return normalize(option.value) === normalize(value) || normalize(option.textContent) === normalize(value);
    });
    if (match) {
      control.value = match.value;
    }
  } else {
    setNativeValue(control, value);
  }

  control.dispatchEvent(new Event("input", { bubbles: true }));
  control.dispatchEvent(new Event("change", { bubbles: true }));
}

function clearControl(control) {
  const tag = control.tagName.toLowerCase();
  const type = (control.getAttribute("type") || "").toLowerCase();

  if (type === "checkbox" || type === "radio") {
    control.checked = false;
  } else if (tag === "select") {
    control.selectedIndex = 0;
  } else {
    setNativeValue(control, "");
  }

  control.dispatchEvent(new Event("input", { bubbles: true }));
  control.dispatchEvent(new Event("change", { bubbles: true }));
}

function fillMappedFields(profile) {
  const controls = getControls();
  const analysis = analyze(profile);
  let filledCount = 0;

  for (const entry of analysis.mappings) {
    if (!entry.mapping) continue;
    const control = controls[entry.field.index];
    if (!control) continue;
    fillControl(control, entry.mapping.value);
    filledCount += 1;
  }

  return {
    ...analysis,
    filledCount
  };
}

function fillReturnedMappings(mappings) {
  const controls = getControls();
  let filledCount = 0;

  for (const entry of mappings || []) {
    const field = entry.field;
    const mapping = entry.mapping;
    if (!field || !mapping?.value) continue;
    if (!mappingCompatibleWithField(field, mapping)) continue;

    const control =
      controls[field.index] ||
      (field.selector ? document.querySelector(field.selector) : null);

    if (!control) continue;
    fillControl(control, mapping.value);
    filledCount += 1;
  }

  return {
    filledCount
  };
}

function unfillPage() {
  const controls = getControls();
  for (const control of controls) {
    clearControl(control);
  }
  return {
    clearedCount: controls.length,
    fieldCount: controls.length,
    title: document.title
  };
}

function formScore(form) {
  return Array.from(form.querySelectorAll("input, textarea, select")).filter((control) => {
    const type = (control.getAttribute("type") || "").toLowerCase();
    return !["hidden", "submit", "button", "reset", "file", "image"].includes(type) && !control.disabled;
  }).length;
}

function submitBestForm() {
  const forms = Array.from(document.forms)
    .map((form) => ({ form, score: formScore(form) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  const target = forms[0]?.form || getControls()[0]?.closest("form");
  if (!target) {
    return { submitted: false, reason: "No form found" };
  }

  const submitter = target.querySelector(
    'button[type="submit"], input[type="submit"], button:not([type])'
  );

  if (submitter) {
    submitter.click();
  } else if (typeof target.requestSubmit === "function") {
    target.requestSubmit();
  } else {
    target.submit();
  }

  return { submitted: true };
}

function fillAndMaybeSubmit(profile, submitMode) {
  const result = fillMappedFields(profile);
  if (submitMode === "direct" && result.filledCount > 0) {
    return {
      ...result,
      submit: submitBestForm()
    };
  }
  return result;
}

let autoFillTimer = null;
let lastAutoFillSignature = "";
let autoFillPausedForPage = false;
let curionPrompt = null;
let lastPromptSignature = "";

function buildAutoFillSignature(profile) {
  const controls = getControls();
  return JSON.stringify({
    href: window.location.href,
    fieldCount: controls.length,
    labels: controls.slice(0, 40).map(labelFor),
    profileKeys: Object.keys(profile || {}).filter((key) => String(profile[key] || "").trim()).sort()
  });
}

function promptStyles() {
  return `
    #curion-root {
      position: fixed;
      right: 18px;
      bottom: 18px;
      z-index: 2147483647;
      width: min(360px, calc(100vw - 32px));
      border: 1px solid #dedede;
      border-radius: 10px;
      background: #ffffff;
      color: #080808;
      box-shadow: 0 18px 48px rgba(0, 0, 0, 0.18);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      overflow: hidden;
    }

    .curion-card {
      display: grid;
      gap: 12px;
      padding: 14px;
    }

    .curion-head,
    .curion-actions,
    .curion-stats {
      display: flex;
      align-items: center;
    }

    .curion-head,
    .curion-actions {
      justify-content: space-between;
      gap: 10px;
    }

    .curion-brand {
      display: flex;
      align-items: center;
      min-width: 0;
      gap: 9px;
      font-weight: 800;
      font-size: 14px;
    }

    .curion-mark {
      display: grid;
      width: 28px;
      height: 28px;
      flex: 0 0 auto;
      place-items: center;
      border-radius: 7px;
      background: #080808;
      color: #ffffff;
      font-weight: 850;
    }

    .curion-close {
      width: 30px;
      min-height: 30px;
      border: 1px solid #dedede;
      border-radius: 7px;
      background: #ffffff;
      color: #666666;
      cursor: pointer;
      font: inherit;
      font-weight: 800;
    }

    .curion-message {
      margin: 0;
      color: #555555;
      font-size: 12px;
      line-height: 1.45;
    }

    .curion-stats {
      gap: 8px;
      flex-wrap: wrap;
    }

    .curion-pill {
      padding: 6px 8px;
      border: 1px solid #dedede;
      border-radius: 999px;
      color: #555555;
      background: #fafafa;
      font-size: 11px;
      font-weight: 800;
    }

    .curion-primary,
    .curion-secondary {
      min-height: 36px;
      padding: 0 12px;
      border-radius: 7px;
      cursor: pointer;
      font: inherit;
      font-size: 12px;
      font-weight: 850;
    }

    .curion-primary {
      border: 1px solid #080808;
      background: #080808;
      color: #ffffff;
    }

    .curion-primary:disabled {
      border-color: #dedede;
      background: #f3f3f3;
      color: #9a9a9a;
      cursor: not-allowed;
    }

    .curion-secondary {
      border: 1px solid #dedede;
      background: #ffffff;
      color: #080808;
    }

    .curion-unmapped {
      max-height: 92px;
      overflow: auto;
      padding-top: 2px;
      color: #666666;
      font-size: 11px;
      line-height: 1.45;
    }
  `;
}

function removeCurionPrompt() {
  curionPrompt?.remove();
  curionPrompt = null;
}

function unmappedLabels(analysis, limit = 5) {
  return (analysis.mappings || [])
    .filter((entry) => !entry.mapping)
    .map((entry) => entry.field?.label)
    .filter(Boolean)
    .slice(0, limit);
}

function pluralize(count, singular, plural = `${singular}s`) {
  return count === 1 ? singular : plural;
}

function renderCurionPrompt(analysis, message) {
  removeCurionPrompt();

  const root = document.createElement("div");
  root.id = "curion-root";
  root.setAttribute("role", "status");
  root.setAttribute("aria-live", "polite");
  root.innerHTML = `
    <style>${promptStyles()}</style>
    <div class="curion-card">
      <div class="curion-head">
        <div class="curion-brand"><span class="curion-mark">C</span><span>Curion found a form</span></div>
        <button class="curion-close" type="button" aria-label="Dismiss Curion">x</button>
      </div>
      <p class="curion-message"></p>
      <div class="curion-stats">
        <span class="curion-pill curion-field-count"></span>
        <span class="curion-pill curion-match-count"></span>
      </div>
      <div class="curion-unmapped" hidden></div>
      <div class="curion-actions">
        <button class="curion-secondary" type="button">Not now</button>
        <button class="curion-primary" type="button">Auto-fill</button>
      </div>
    </div>
  `;

  const primary = root.querySelector(".curion-primary");
  const secondary = root.querySelector(".curion-secondary");
  const close = root.querySelector(".curion-close");
  const messageElement = root.querySelector(".curion-message");
  const fieldsElement = root.querySelector(".curion-field-count");
  const matchesElement = root.querySelector(".curion-match-count");
  const unmappedElement = root.querySelector(".curion-unmapped");

  messageElement.textContent = message || "Review and fill the fields Curion can confidently map.";
  fieldsElement.textContent = `${analysis.fieldCount} fields`;
  matchesElement.textContent = `${analysis.mappedCount} can fill`;
  primary.disabled = analysis.mappedCount === 0;

  primary.addEventListener("click", async () => {
    const stored = await chrome.storage.local.get([
      "curionProfile",
      "curionWorkingMetadata",
      "curionSubmitMode"
    ]);
    const profile = activeProfileFromSettings(stored);
    const result = fillAndMaybeSubmit(profile, stored.curionSubmitMode || "review");
    const remaining = Math.max(0, result.fieldCount - result.filledCount);
    const skipped = unmappedLabels(result);

    messageElement.textContent = remaining
      ? `Curion filled ${result.filledCount} ${pluralize(result.filledCount, "field")}. ${remaining} ${pluralize(remaining, "field")} need your input.`
      : `Curion filled all ${result.filledCount} matched ${pluralize(result.filledCount, "field")}.`;
    fieldsElement.textContent = `${result.fieldCount} ${pluralize(result.fieldCount, "field")}`;
    matchesElement.textContent = `${result.filledCount} filled`;
    primary.textContent = "Done";
    primary.disabled = true;
    secondary.textContent = "Close";

    if (skipped.length) {
      unmappedElement.hidden = false;
      unmappedElement.textContent = `Skipped: ${skipped.join(", ")}${remaining > skipped.length ? ", ..." : ""}`;
    }
  });

  secondary.addEventListener("click", () => {
    autoFillPausedForPage = true;
    removeCurionPrompt();
  });
  close.addEventListener("click", () => {
    autoFillPausedForPage = true;
    removeCurionPrompt();
  });

  document.documentElement.append(root);
  curionPrompt = root;
}

async function maybeAutoFill() {
  if (autoFillPausedForPage) return;

  const stored = await chrome.storage.local.get([
    "curionAutoFillEnabled",
    "curionProfile",
    "curionWorkingMetadata",
    "curionSubmitMode"
  ]);

  if (!stored.curionAutoFillEnabled) return;
  const profile = activeProfileFromSettings(stored);
  if (!hasProfile(profile) || getControls().length === 0) return;

  const signature = buildAutoFillSignature(profile);
  if (signature === lastAutoFillSignature) return;
  lastAutoFillSignature = signature;

  const analysis = analyze(profile);
  const promptSignature = JSON.stringify({
    signature,
    mappedCount: analysis.mappedCount,
    fieldCount: analysis.fieldCount
  });

  if (promptSignature === lastPromptSignature) return;
  lastPromptSignature = promptSignature;

  renderCurionPrompt(
    analysis,
    analysis.mappedCount
      ? "Curion can partially fill this form. Unmapped fields will be left for you."
      : "Curion found a form, but none of these fields match your saved metadata yet."
  );
}

function scheduleAutoFill() {
  window.clearTimeout(autoFillTimer);
  autoFillTimer = window.setTimeout(() => {
    maybeAutoFill().catch(() => {
      // Auto-fill should never break the host page.
    });
  }, 700);
}

scheduleAutoFill();

const observer = new MutationObserver(() => scheduleAutoFill());
observer.observe(document.documentElement, {
  childList: true,
  subtree: true
});

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CURION_ANALYZE") {
    sendResponse(analyze(message.profile || {}));
    return true;
  }

  if (message?.type === "CURION_FILL") {
    sendResponse(fillAndMaybeSubmit(message.profile || {}, message.submitMode || "review"));
    return true;
  }

  if (message?.type === "CURION_COLLECT_PAGE") {
    sendResponse(collectPageSnapshot());
    return true;
  }

  if (message?.type === "CURION_FILL_MAPPINGS") {
    const result = fillReturnedMappings(message.mappings || []);
    if (message.submitMode === "direct" && result.filledCount > 0) {
      result.submit = submitBestForm();
    }
    sendResponse(result);
    return true;
  }

  if (message?.type === "CURION_UNFILL") {
    autoFillPausedForPage = true;
    sendResponse(unfillPage());
    return true;
  }

  return false;
});
