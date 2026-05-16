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
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
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

function profileValueForField(field, profile) {
  const haystack = normalize([field.label, field.name, field.placeholder].join(" "));
  let bestKey = "";
  let bestScore = 0;

  for (const [key, hints] of Object.entries(PROFILE_SCHEMA)) {
    const score = hints.reduce((total, hint) => {
      return total + (haystack.includes(normalize(hint)) ? 1 : 0);
    }, 0);

    if (score > bestScore && profile[key]) {
      bestKey = key;
      bestScore = score;
    }
  }

  if (!bestKey) {
    for (const entry of metadataEntries(profile)) {
      const keyScore = normalize(entry.label)
        .split(" ")
        .filter((token) => token.length > 1 && haystack.includes(token)).length;

      if (keyScore > bestScore) {
        bestKey = entry.key;
        bestScore = keyScore;
      }
    }
  }

  if (!bestKey) return null;
  const value = metadataEntries(profile).find((entry) => entry.key === bestKey)?.value || profile[bestKey];
  return {
    key: bestKey,
    value: String(value),
    confidence: Math.min(0.96, 0.62 + bestScore * 0.12)
  };
}

function analyze(profile) {
  const fields = extractFields();
  const mappings = fields.map((field) => ({
    field,
    mapping: profileValueForField(field, profile)
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

function buildAutoFillSignature(profile) {
  const controls = getControls();
  return JSON.stringify({
    href: window.location.href,
    fieldCount: controls.length,
    labels: controls.slice(0, 40).map(labelFor),
    profileKeys: Object.keys(profile || {}).filter((key) => String(profile[key] || "").trim()).sort()
  });
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

  fillAndMaybeSubmit(profile, stored.curionSubmitMode || "review");
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
