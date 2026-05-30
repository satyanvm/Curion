(() => {
const DEFAULT_API_URL = "https://backend-three-mu-84.vercel.app/api/agent/map-form";
type Dict = Record<string, any>;
type AnyRecord = Record<string, any>;
type FieldInfo = {
  index: number;
  label: string;
  selector: string;
  type: string;
  name: string;
  placeholder: string;
  options: string[];
};
type FieldMapping = {
  field: FieldInfo;
  mapping: {
    key: string;
    semanticPath: string;
    value: string;
    confidence: number;
    method?: string;
    reasons?: string[];
    reviewRequired?: boolean;
  } | null;
};
type PageSnapshot = {
  url: string;
  title: string;
  html: string;
  fields: FieldInfo[];
  fieldCount: number;
  goal: string;
  profile?: Dict;
  userId?: string;
};

/** @typedef {Record<string, any>} Dict */
/** @typedef {{
 *   index: number;
 *   label: string;
 *   selector: string;
 *   type: string;
 *   name: string;
 *   placeholder: string;
 *   options: string[];
 * }} FieldInfo */
/** @typedef {{
 *   key: string;
 *   semanticPath: string;
 *   value: string;
 *   confidence: number;
 *   method?: string;
 *   reasons?: string[];
 *   reviewRequired?: boolean;
 * }} MappingInfo */
/** @typedef {{
 *   field: FieldInfo;
 *   mapping: MappingInfo | null;
 *   candidates?: Array<{ semanticPath: string; confidence: number; distance: number }>;
 * }} FieldMapping */
/** @typedef {{
 *   url: string;
 *   title: string;
 *   html: string;
 *   fields: FieldInfo[];
 *   fieldCount: number;
 *   goal: string;
 *   profile?: Dict;
 *   userId?: string;
 * }} PageSnapshot */
/** @typedef {{
 *   url: string;
 *   title: string;
 *   fieldCount: number;
 *   mappedCount: number;
 *   mappings: FieldMapping[];
 *   source?: string;
 *   overallConfidence?: number;
 * }} Analysis */
/** @typedef {{
 *   curionMetadataSource?: string;
 *   curionWorkingMetadata?: Dict;
 *   curionProfile?: Dict;
 *   curionUserId?: string;
 *   curionUseBackendProfile?: boolean;
 *   curionSubmitMode?: string;
 *   curionAutoFillEnabled?: boolean;
 * }} Settings */

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

/** @param {Element | null | undefined} element */
function asControlElement(element) {
  return element && element instanceof HTMLElement ? element : null;
}

function cssPath(element) {
  const el = element;
  if (el instanceof HTMLElement && el.id) {
    return `#${CSS.escape(el.id)}`;
  }

  if (!(el instanceof HTMLElement)) {
    return "";
  }

  const name = el.getAttribute("name");
  if (name) {
    return `${el.tagName.toLowerCase()}[name="${CSS.escape(name)}"]`;
  }

  const parts = [];
  let current = el;
  while (current && parts.length < 5) {
    let part = current.tagName.toLowerCase();
    const parent = current.parentElement;
    if (!parent) break;

    const siblings = Array.from(parent.children).filter((child) => child instanceof HTMLElement && child.tagName === current.tagName);
    if (siblings.length > 1) {
      part += `:nth-of-type(${siblings.indexOf(current) + 1})`;
    }

    parts.unshift(part);
    current = parent;
  }

  return parts.join(" > ");
}

function labelFor(control) {
  const el = control;
  if (!(el instanceof HTMLElement)) return "Unnamed field";

  const explicitLabel = el.id
    ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`)
    : null;
  const parentLabel = el.closest("label");
  const ariaLabel = el.getAttribute("aria-label");
  const labelledBy = el.getAttribute("aria-labelledby");
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
    el.getAttribute("placeholder") ||
    el.getAttribute("name") ||
    el.id ||
    "Unnamed field"
  )
    .replace(/\s+/g, " ")
    .trim();
}

function controlIntentText(control) {
  const el = control as HTMLElement;
  return normalize([
    labelFor(el),
    el.getAttribute("name"),
    el.id,
    el.getAttribute("placeholder"),
    el.getAttribute("autocomplete"),
    el.getAttribute("aria-label"),
    el.getAttribute("role")
  ].join(" "));
}

function isLowIntentControl(control) {
  const el = control as HTMLElement;
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute("type") || "").toLowerCase();
  const intentText = controlIntentText(control);
  const container = el.closest("search, [role='search'], nav, header");

  if (type === "search" || el.getAttribute("role") === "searchbox") return true;
  if (container && containsAny(intentText, ["search", "query", "keyword", "find"])) return true;
  if (tag === "input" && containsAny(intentText, ["search", "query", "keyword"])) return true;
  return false;
}

function getControls() {
  return Array.from(document.querySelectorAll("input, textarea, select")).filter((control) => {
    if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement)) {
      return false;
    }
    const type = (control.getAttribute("type") || "").toLowerCase();
    if (control.closest("#curion-root")) return false;
    if (["hidden", "submit", "button", "reset", "file", "image", "password", "search"].includes(type)) return false;
    if (control.disabled || ("readOnly" in control && control.readOnly)) return false;
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
    options: control instanceof HTMLSelectElement
      ? Array.from(control.options).map((option: HTMLOptionElement) => option.textContent?.trim() || "").filter(Boolean)
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
  const form = control instanceof HTMLElement ? control.closest("form") : null;
  return form instanceof HTMLFormElement ? formScore(form) >= 2 : false;
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
  return "saved";
}

function resolveSubmitMode(value) {
  const mode = String(value || "");
  return mode === "direct" || mode === "workflow" ? mode : "review";
}

function activeProfileFromSettings(settings) {
  const source = resolveMetadataSource(settings);
  if (source === "saved") return settings.curionProfile || {};
  return hasProfile(settings.curionWorkingMetadata)
    ? settings.curionWorkingMetadata
    : settings.curionProfile || {};
}

function savedBackendUserId(settings) {
  if (resolveMetadataSource(settings) === "working") return "";
  if (settings?.curionUseBackendProfile === false) return "";
  return String(settings?.curionUserId || "").trim();
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

/** @param {Settings} settings @param {Dict | null} profileOverride */
async function analyzeWithStoredBackendProfile(settings, profileOverride = null) {
  const pageSnapshot = collectPageSnapshot();
  const userId = savedBackendUserId(settings);
  const activeProfile = profileOverride && hasProfile(profileOverride)
    ? profileOverride
    : activeProfileFromSettings(settings);
  const requestBody: PageSnapshot & { profile?: Dict; userId?: string } = {
    goal: "Fill this page with the active Curion metadata.",
    ...pageSnapshot
  };

  if (userId) {
    requestBody.userId = userId;
  } else if (hasProfile(activeProfile)) {
    requestBody.profile = activeProfile;
  } else {
    return null;
  }

  const response = await fetch(DEFAULT_API_URL, {
    method: "POST",
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

/** @param {Settings} settings @param {Dict | null} profileOverride */
async function fillWithBackendProfile(settings, profileOverride = null) {
  const analysis = await analyzeWithStoredBackendProfile(settings, profileOverride);
  if (!analysis) {
    return {
      fieldCount: 0,
      mappedCount: 0,
      mappings: [],
      filledCount: 0,
      submit: null
    };
  }

  const result = fillReturnedMappings(analysis.mappings || []) as AnyRecord;
  const submitMode = resolveSubmitMode(settings?.curionSubmitMode);

  if ((submitMode === "direct" || submitMode === "workflow") && result.filledCount > 0) {
    result.submit = runPostFillAction(submitMode);
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
  const el = control;
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute("type") || "").toLowerCase();

  if (type === "checkbox" || type === "radio") {
    const normalizedValue = normalize(value);
    el.checked = ["yes", "true", "1", "agree", "accepted"].includes(normalizedValue);
  } else if (tag === "select") {
    const select = el as HTMLSelectElement;
    const options = Array.from(select.options);
    const match = options.find((option: HTMLOptionElement) => {
      return normalize(option.value) === normalize(value) || normalize(option.textContent) === normalize(value);
    });
    if (match) {
      select.value = match.value;
    }
  } else {
    setNativeValue(el, value);
  }

  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
}

function clearControl(control) {
  const el = control;
  const tag = el.tagName.toLowerCase();
  const type = (el.getAttribute("type") || "").toLowerCase();

  if (type === "checkbox" || type === "radio") {
    el.checked = false;
  } else if (tag === "select") {
    el.selectedIndex = 0;
  } else {
    setNativeValue(el, "");
  }

  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
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

    if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement)) continue;
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
    if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement)) return false;
    const type = (control.getAttribute("type") || "").toLowerCase();
    return !["hidden", "submit", "button", "reset", "file", "image"].includes(type) && !control.disabled;
  }).length;
}

function isElementVisible(element) {
  if (!(element instanceof HTMLElement)) return false;
  if (element.closest("#curion-root")) return false;
  if ("disabled" in element && element.disabled) return false;
  if (element.getAttribute("aria-disabled") === "true") return false;

  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;

  const rect = element.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0;
}

function actionText(element) {
  const el = element as HTMLElement;
  return normalize([
    el.textContent,
    el.getAttribute("aria-label"),
    el.getAttribute("title"),
    el.getAttribute("name"),
    el.id,
    el.getAttribute("value"),
    el.className
  ].join(" "));
}

function hasActionTerm(text, terms) {
  return terms.some((term) => {
    const normalizedTerm = normalize(term);
    return normalizedTerm.includes(" ")
      ? text.includes(normalizedTerm)
      : text.split(" ").includes(normalizedTerm);
  });
}

function buttonLabel(element) {
  if (!(element instanceof HTMLElement)) return "selected action";
  return (
    element.textContent ||
    element.getAttribute("aria-label") ||
    element.getAttribute("value") ||
    element.getAttribute("name") ||
    element.id ||
    "selected action"
  ).replace(/\s+/g, " ").trim();
}

function bestForm() {
  const forms = Array.from(document.forms)
    .map((form) => ({ form, score: formScore(form) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return forms[0]?.form || getControls()[0]?.closest("form");
}

function scoreWorkflowAction(element, preferredForm) {
  if (!(element instanceof HTMLElement) || !isElementVisible(element)) return 0;

  const tag = element.tagName.toLowerCase();
  const type = (element.getAttribute("type") || "").toLowerCase();
  const role = element.getAttribute("role");
  if (!["button", "input", "a"].includes(tag) && role !== "button") return 0;
  if (tag === "input" && !["submit", "button"].includes(type)) return 0;
  if (type === "reset" || type === "file" || type === "image") return 0;

  const text = actionText(element);
  if (!text) return 0;
  if (hasActionTerm(text, ["back", "previous", "cancel", "clear", "reset", "delete", "remove", "close", "logout", "sign out", "search", "filter"])) {
    return 0;
  }

  let score = 0;
  if (type === "submit") score += 25;
  if (preferredForm && element.closest("form") === preferredForm) score += 18;
  if (hasActionTerm(text, ["save and next", "save next", "submit and next", "submit next", "next step"])) score += 55;
  if (hasActionTerm(text, ["submit", "send", "continue", "next", "proceed", "finish", "complete", "done"])) score += 42;
  if (hasActionTerm(text, ["save"])) score += 24;

  return score;
}

function findWorkflowAction(preferredForm = null) {
  const selectors = [
    "button",
    "input[type='submit']",
    "input[type='button']",
    "[role='button']",
    "a[href]"
  ].join(",");
  const candidates = Array.from(document.querySelectorAll(selectors))
    .map((element) => ({ element, score: scoreWorkflowAction(element, preferredForm) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  return candidates[0]?.element || null;
}

function controlHasValue(control) {
  if (control instanceof HTMLInputElement) {
    const type = (control.getAttribute("type") || "").toLowerCase();
    if (type === "checkbox") return control.checked;
    if (type === "radio") {
      const groupName = control.name;
      const group = groupName
        ? Array.from(document.querySelectorAll(`input[type="radio"][name="${CSS.escape(groupName)}"]`))
        : [control];
      return group.some((item) => item instanceof HTMLInputElement && item.checked);
    }
    return Boolean(control.value.trim());
  }

  if (control instanceof HTMLTextAreaElement) return Boolean(control.value.trim());
  if (control instanceof HTMLSelectElement) return Boolean(control.value);
  return false;
}

function emptyRequiredControls(root) {
  return Array.from(root.querySelectorAll("input, textarea, select")).filter((control) => {
    if (!(control instanceof HTMLInputElement || control instanceof HTMLTextAreaElement || control instanceof HTMLSelectElement)) return false;
    if (!control.required || !isElementVisible(control)) return false;
    return !controlHasValue(control);
  });
}

function submitBestForm() {
  const target = bestForm();
  if (!target) {
    return { submitted: false, reason: "No form found" };
  }

  const submitter = target.querySelector(
    'button[type="submit"], input[type="submit"], button:not([type])'
  );
  const label = submitter instanceof HTMLElement ? buttonLabel(submitter) : "form submit";

  if (submitter instanceof HTMLElement) {
    submitter.click();
  } else if (typeof target.requestSubmit === "function") {
    target.requestSubmit();
  } else {
    target.submit();
  }

  return { submitted: true, action: "submit", label };
}

function runWorkflowAction() {
  const target = bestForm();
  const missingRequired = emptyRequiredControls(target || document);
  if (missingRequired.length > 0) {
    return {
      submitted: false,
      reason: `${missingRequired.length} required ${pluralize(missingRequired.length, "field")} still need input`
    };
  }

  const action = findWorkflowAction(target);
  if (!action || !(action instanceof HTMLElement)) {
    return { submitted: false, reason: "No submit or next action found" };
  }

  const label = buttonLabel(action);
  action.click();
  return { submitted: true, action: "workflow", label };
}

function runPostFillAction(submitMode) {
  if (submitMode === "workflow") {
    return runWorkflowAction();
  }

  return submitBestForm();
}

function isWorkflowMode(settings) {
  return resolveSubmitMode(settings?.curionSubmitMode) === "workflow";
}

/** @type {number | null} */
let autoFillTimer = null;
let lastAutoFillSignature = "";
let autoFillPausedForPage = false;
/** @type {HTMLElement | null} */
let curionPrompt = null;
let lastPromptSignature = "";

/** @param {Dict} profile @param {Settings} settings */
function buildAutoFillSignature(profile, settings) {
  const controls = getControls();
  return JSON.stringify({
    href: window.location.href,
    fieldCount: controls.length,
    labels: controls.slice(0, 40).map(labelFor),
    profileKeys: Object.keys(profile || {}).filter((key) => String(profile[key] || "").trim()).sort(),
    profileUserId: savedBackendUserId(settings),
    metadataSource: resolveMetadataSource(settings),
    submitMode: resolveSubmitMode(settings?.curionSubmitMode)
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

/** @param {Analysis | null} analysis */
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

/** @param {Analysis} analysis @param {string} message */
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

  if (!(primary instanceof HTMLButtonElement) ||
      !(secondary instanceof HTMLButtonElement) ||
      !(close instanceof HTMLButtonElement) ||
      !(messageElement instanceof HTMLElement) ||
      !(fieldsElement instanceof HTMLElement) ||
      !(matchesElement instanceof HTMLElement) ||
      !(unmappedElement instanceof HTMLElement)) {
    return;
  }

  messageElement.textContent = message || "Review and fill the fields Curion can confidently map.";
  fieldsElement.textContent = `${analysis.fieldCount} fields`;
  matchesElement.textContent = `${analysis.mappedCount} can fill`;
  primary.disabled = analysis.mappedCount === 0;

  primary.addEventListener("click", async () => {
    const stored = await readBackendSettings();
    const submitMode = resolveSubmitMode(stored.curionSubmitMode);
    const result = analysis?.source
      ? fillReturnedMappings(analysis.mappings || [])
      : await fillWithBackendProfile(stored);

    if (analysis?.source && (submitMode === "direct" || submitMode === "workflow") && result.filledCount > 0) {
      result.submit = runPostFillAction(submitMode);
    }

    const totalFields = Number(result.fieldCount || analysis.fieldCount || 0);
    const remaining = Math.max(0, totalFields - result.filledCount);
    const skipped = analysis?.source ? unmappedLabels(analysis) : unmappedLabels(result);

    messageElement.textContent = result.submit?.submitted
      ? `Curion filled ${result.filledCount} ${pluralize(result.filledCount, "field")} and ${result.submit.action === "workflow" ? "continued" : "submitted"}.`
      : remaining
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
    "curionUserId",
    "curionUseBackendProfile",
    "curionSubmitMode"
  ]);

  if (!stored.curionAutoFillEnabled) return;
  const profile = activeProfileFromSettings(stored);
  if (!savedBackendUserId(stored) && !hasProfile(profile)) return;
  if (getControls().length === 0) return;

  const signature = buildAutoFillSignature(profile, stored);
  if (signature === lastAutoFillSignature) return;
  lastAutoFillSignature = signature;

  const analysis = await analyzeWithStoredBackendProfile(stored, profile);
  if (!shouldOfferAutoFill(analysis)) {
    removeCurionPrompt();
    return;
  }

  if (isWorkflowMode(stored) && analysis.mappedCount > 0) {
    const result = fillReturnedMappings(analysis.mappings || []) as AnyRecord;
    if (result.filledCount > 0) {
      result.submit = runPostFillAction("workflow");
    }
    if (result.submit?.submitted) {
      removeCurionPrompt();
      return;
    }
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
      .catch((error) => sendResponse({ error: error instanceof Error ? error.message : "Backend mapping failed" }));
    return true;
  }

  if (message?.type === "CURION_FILL") {
    readBackendSettings()
      .then((settings) => fillWithBackendProfile(
        { ...settings, curionSubmitMode: resolveSubmitMode(message.submitMode || settings.curionSubmitMode) },
        message.profile || {}
      ))
      .then(sendResponse)
      .catch((error) => sendResponse({ error: error instanceof Error ? error.message : "Backend fill failed", filledCount: 0 }));
    return true;
  }

  if (message?.type === "CURION_COLLECT_PAGE") {
    sendResponse(collectPageSnapshot());
    return true;
  }

  if (message?.type === "CURION_FILL_MAPPINGS") {
    const submitMode = resolveSubmitMode(message.submitMode);
    const result = fillReturnedMappings(message.mappings || []) as AnyRecord;
    if ((submitMode === "direct" || submitMode === "workflow") && result.filledCount > 0) {
      result.submit = runPostFillAction(submitMode);
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
})();
