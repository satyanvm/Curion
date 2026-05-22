const DEFAULT_API_URL = "https://backend-three-mu-84.vercel.app/api/agent/map-form";

function normalize(text) {
  return String(text || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
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

function metadataEntries(metadata) {
  if (!metadata || typeof metadata !== "object") return [];

  return Object.values(metadata).flatMap((value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return metadataEntries(value);
    }
    if (value === undefined || value === null || value === "") return [];
    return [value];
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

function controlIntentText(control) {
  return normalize([
    labelFor(control),
    control.getAttribute("name"),
    control.id,
    control.getAttribute("placeholder"),
    control.getAttribute("autocomplete"),
    control.getAttribute("aria-label"),
    control.getAttribute("role")
  ].join(" "));
}

function isLowIntentControl(control) {
  const tag = control.tagName.toLowerCase();
  const type = (control.getAttribute("type") || "").toLowerCase();
  const intentText = controlIntentText(control);
  const container = control.closest("search, [role='search'], nav, header");

  if (type === "search" || control.getAttribute("role") === "searchbox") return true;
  if (container && containsAny(intentText, ["search", "query", "keyword", "find"])) return true;
  if (tag === "input" && containsAny(intentText, ["search", "query", "keyword"])) return true;
  return false;
}

function getControls() {
  return Array.from(document.querySelectorAll("input, textarea, select")).filter((control) => {
    const type = (control.getAttribute("type") || "").toLowerCase();
    if (control.closest("#curion-root")) return false;
    if (["hidden", "submit", "button", "reset", "file", "image", "password", "search"].includes(type)) return false;
    if (control.disabled || control.readOnly) return false;
    if (isLowIntentControl(control)) return false;
    const style = window.getComputedStyle(control);
    return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
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

function fieldLooksRich(field) {
  return ["textarea", "select", "checkbox", "radio"].includes(field.type);
}

function fieldHasFormOwner(field) {
  const control = document.querySelector(field.selector);
  const form = control?.closest("form");
  return form ? formScore(form) >= 2 : false;
}

function shouldOfferAutoFill(analysis) {
  if (!analysis || analysis.mappedCount === 0) return false;
  if (analysis.fieldCount >= 2) return true;
  if ((analysis.mappings || []).filter((entry) => entry.mapping).length >= 2) return true;
  return (analysis.mappings || []).some((entry) => {
    return entry.mapping && (fieldLooksRich(entry.field) || fieldHasFormOwner(entry.field));
  });
}

function hasProfile(profile) {
  return metadataEntries(profile).length > 0;
}

function resolveMetadataSource(settings) {
  const source = String(settings?.curionMetadataSource || "");
  if (source === "saved" || source === "working") return source;
  return hasProfile(settings?.curionWorkingMetadata) ? "working" : "saved";
}

function activeProfileFromSettings(settings) {
  const source = resolveMetadataSource(settings);
  if (source === "saved") return settings.curionProfile || {};
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

function usingStoredBackendProfile(settings) {
  return Boolean(
    settings?.curionUseBackendProfile &&
      String(settings?.curionUserId || "").trim() &&
      String(settings?.curionApiUrl || DEFAULT_API_URL).trim()
  );
}

async function analyzeWithStoredBackendProfile(settings, profileOverride = null) {
  const apiUrl = String(settings?.curionApiUrl || DEFAULT_API_URL).trim();
  const userId = String(settings?.curionUserId || "").trim();
  if (!apiUrl) return null;

  const pageSnapshot = collectPageSnapshot();
  const activeProfile = profileOverride && hasProfile(profileOverride)
    ? profileOverride
    : activeProfileFromSettings(settings);
  const requestBody = {
    goal: "Fill this page with the active Curion metadata.",
    ...pageSnapshot
  };

  if (settings?.curionUseBackendProfile && userId) {
    requestBody.userId = userId;
  } else if (hasProfile(activeProfile)) {
    requestBody.profile = activeProfile;
  } else {
    return null;
  }

  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(requestBody)
  });

  if (!response.ok) {
    throw new Error(`Backend mapping failed with status ${response.status}`);
  }

  const responsePayload = await response.json();
  return {
    ...responsePayload,
    title: responsePayload?.title || document.title,
    fieldCount: Number(responsePayload?.fieldCount || pageSnapshot.fieldCount || 0),
    mappedCount: Number(responsePayload?.mappedCount || 0),
    mappings: Array.isArray(responsePayload?.mappings) ? responsePayload.mappings : []
  };
}

async function fillWithBackendProfile(settings, profileOverride = null) {
  const analysis = await analyzeWithStoredBackendProfile(settings, profileOverride);
  if (!analysis) {
    return {
      fieldCount: 0,
      mappedCount: 0,
      mappings: [],
      filledCount: 0
    };
  }

  const result = fillReturnedMappings(analysis.mappings || []);
  const submitMode = settings?.curionSubmitMode || "review";

  if (submitMode === "direct" && result.filledCount > 0) {
    result.submit = submitBestForm();
  }

  return {
    ...analysis,
    ...result
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

async function readBackendSettings() {
  return chrome.storage.local.get([
    "curionProfile",
    "curionWorkingMetadata",
    "curionMetadataSource",
    "curionApiUrl",
    "curionUserId",
    "curionUseBackendProfile",
    "curionSubmitMode"
  ]);
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

let autoFillTimer = null;
let lastAutoFillSignature = "";
let autoFillPausedForPage = false;
let curionPrompt = null;
let lastPromptSignature = "";

function buildAutoFillSignature(profile, settings) {
  const controls = getControls();
  return JSON.stringify({
    href: window.location.href,
    fieldCount: controls.length,
    labels: controls.slice(0, 40).map(labelFor),
    profileKeys: Object.keys(profile || {}).filter((key) => String(profile[key] || "").trim()).sort(),
    metadataSource: resolveMetadataSource(settings),
    useBackendProfile: usingStoredBackendProfile(settings),
    userId: String(settings?.curionUserId || "").trim()
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
    const stored = await readBackendSettings();
    const submitMode = stored.curionSubmitMode || "review";
    const result = analysis?.source
      ? fillReturnedMappings(analysis.mappings || [])
      : await fillWithBackendProfile(stored);

    if (analysis?.source && submitMode === "direct" && result.filledCount > 0) {
      result.submit = submitBestForm();
    }

    const totalFields = Number(result.fieldCount || analysis.fieldCount || 0);
    const remaining = Math.max(0, totalFields - result.filledCount);
    const skipped = analysis?.source ? unmappedLabels(analysis) : unmappedLabels(result);

    messageElement.textContent = remaining
      ? `Curion filled ${result.filledCount} ${pluralize(result.filledCount, "field")}. ${remaining} ${pluralize(remaining, "field")} need your input.`
      : `Curion filled all ${result.filledCount} matched ${pluralize(result.filledCount, "field")}.`;
    fieldsElement.textContent = `${totalFields} ${pluralize(totalFields, "field")}`;
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
    "curionMetadataSource",
    "curionApiUrl",
    "curionUserId",
    "curionUseBackendProfile",
    "curionSubmitMode"
  ]);

  if (!stored.curionAutoFillEnabled) return;
  const profile = activeProfileFromSettings(stored);
  if (!String(stored.curionApiUrl || DEFAULT_API_URL).trim()) return;
  if (!usingStoredBackendProfile(stored) && !hasProfile(profile)) return;
  if (getControls().length === 0) return;

  const signature = buildAutoFillSignature(profile, stored);
  if (signature === lastAutoFillSignature) return;
  lastAutoFillSignature = signature;

  const analysis = await analyzeWithStoredBackendProfile(stored, profile);
  if (!shouldOfferAutoFill(analysis)) {
    removeCurionPrompt();
    return;
  }

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
    readBackendSettings()
      .then((settings) => analyzeWithStoredBackendProfile(settings, message.profile || {}))
      .then((analysis) => sendResponse(analysis || {
        url: window.location.href,
        title: document.title,
        fieldCount: getControls().length,
        mappedCount: 0,
        mappings: []
      }))
      .catch((error) => sendResponse({ error: error?.message || "Backend mapping failed" }));
    return true;
  }

  if (message?.type === "CURION_FILL") {
    readBackendSettings()
      .then((settings) => fillWithBackendProfile(
        { ...settings, curionSubmitMode: message.submitMode || settings.curionSubmitMode || "review" },
        message.profile || {}
      ))
      .then(sendResponse)
      .catch((error) => sendResponse({ error: error?.message || "Backend fill failed", filledCount: 0 }));
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
