(() => {
type AnyRecord = Record<string, any>;
type State = {
  profile: AnyRecord | null;
  workingMetadata: AnyRecord;
  activeMetadata: AnyRecord | null;
  metadataSource: string;
  userId: string;
  submitMode: string;
  autoFillEnabled: boolean;
  analysis: AnyRecord | null;
};

const DEFAULT_PROFILE: AnyRecord = {
  name: "Satya Narayan Verma",
  email: "satya@example.com",
  phone: "+91 9876543210",
  company: "",
  jobTitle: "",
  address: "",
  city: "",
  state: "",
  postalCode: "",
  country: "",
  linkedin: "https://www.linkedin.com/in/satyanvm/",
  website: "",
  preferredContactMethod: "Email",
  notes: "",
  acceptTerms: "yes"
};

const DEFAULT_API_URL = "https://backend-three-mu-84.vercel.app/api/agent/map-form";

const state: State = {
  profile: null,
  workingMetadata: {},
  activeMetadata: null,
  metadataSource: "saved",
  userId: "",
  submitMode: "review",
  autoFillEnabled: false,
  analysis: null
};

function hasMetadata(metadata: AnyRecord | null | undefined) {
  return metadataEntries(metadata).length > 0;
}

function resolveMetadataSource(stored: AnyRecord) {
  const source = String(stored?.curionMetadataSource || "");
  if (source === "saved" || source === "working") return source;
  return "saved";
}

function activeMetadataFromState(profile: AnyRecord | null, workingMetadata: AnyRecord, source: string) {
  if (source === "saved") return profile || {};
  return hasMetadata(workingMetadata) ? workingMetadata : (profile || {});
}

function getElements() {
  return {
    pageStatus: document.getElementById("pageStatus") as HTMLElement,
    fieldCount: document.getElementById("fieldCount") as HTMLElement,
    mappedCount: document.getElementById("mappedCount") as HTMLElement,
    scanButton: document.getElementById("scanButton") as HTMLButtonElement,
    fillButton: document.getElementById("fillButton") as HTMLButtonElement,
    unfillButton: document.getElementById("unfillButton") as HTMLButtonElement,
    enableInput: document.getElementById("enableInput") as HTMLInputElement,
    profileWarning: document.getElementById("profileWarning") as HTMLElement,
    metadataMode: document.getElementById("metadataMode") as HTMLElement,
    submitMode: document.getElementById("submitMode") as HTMLElement,
    mappingList: document.getElementById("mappingList") as HTMLElement,
    editProfileButton: document.getElementById("editProfileButton") as HTMLButtonElement,
    openOptionsButton: document.getElementById("openOptionsButton") as HTMLButtonElement,
    useSampleButton: document.getElementById("useSampleButton") as HTMLButtonElement
  };
}

function metadataEntries(metadata: AnyRecord | null | undefined): any[] {
  if (!metadata || typeof metadata !== "object") return [];
  return Object.values(metadata).flatMap((value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return metadataEntries(value);
    }
    if (value === undefined || value === null || value === "") return [];
    return [value];
  });
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function loadProfile() {
  const stored = await chrome.storage.local.get([
    "curionProfile",
    "curionWorkingMetadata",
    "curionMetadataSource",
    "curionUserId",
    "curionUseBackendProfile",
    "curionAutoFillEnabled",
    "curionSubmitMode"
  ]);
  await chrome.storage.local.remove("curionApiUrl");

  state.profile = stored.curionProfile || null;
  state.workingMetadata = stored.curionWorkingMetadata && typeof stored.curionWorkingMetadata === "object"
    ? stored.curionWorkingMetadata
    : {};
  state.metadataSource = resolveMetadataSource(stored);
  state.activeMetadata = activeMetadataFromState(state.profile, state.workingMetadata, state.metadataSource);
  state.userId = stored.curionUseBackendProfile === false ? "" : String(stored.curionUserId || "").trim();
  state.submitMode = stored.curionSubmitMode || "review";
  state.autoFillEnabled = Boolean(stored.curionAutoFillEnabled);
  return state.activeMetadata;
}

async function saveDefaultProfile() {
  await chrome.storage.local.set({ curionProfile: DEFAULT_PROFILE, curionMetadataSource: "saved" });
  state.profile = DEFAULT_PROFILE;
  state.metadataSource = "saved";
  state.activeMetadata = activeMetadataFromState(state.profile, state.workingMetadata, state.metadataSource);
}

async function setCurionEnabled(enabled: boolean) {
  await chrome.storage.local.set({ curionAutoFillEnabled: enabled });
  state.autoFillEnabled = enabled;
  renderProfileState();
}

async function useSampleProfile() {
  await chrome.storage.local.set({
    curionProfile: DEFAULT_PROFILE,
    curionWorkingMetadata: {},
    curionMetadataSource: "saved",
    curionUserId: "",
    curionUseBackendProfile: false,
    curionAutoFillEnabled: true
  });
  state.profile = DEFAULT_PROFILE;
  state.workingMetadata = {};
  state.activeMetadata = DEFAULT_PROFILE;
  state.metadataSource = "saved";
  state.userId = "";
  state.autoFillEnabled = true;
  renderProfileState();
}

function renderProfileState() {
  const elements = getElements();
  const usingSavedProfile = state.metadataSource !== "working";
  const ready = hasMetadata(state.activeMetadata) || (usingSavedProfile && Boolean(state.userId));
  const usingWorkingMetadata = state.metadataSource === "working" && hasMetadata(state.workingMetadata);
  const enabled = state.autoFillEnabled;
  const metadataLabel = ready
      ? (usingWorkingMetadata ? "Working metadata" : "Saved profile")
      : "No metadata";

  elements.profileWarning.hidden = ready;
  elements.scanButton.disabled = !ready || !enabled;
  elements.fillButton.disabled = true;
  elements.enableInput.checked = enabled;
  elements.metadataMode.textContent = `${metadataLabel}${enabled ? " · enabled" : " · off"}`;
  elements.submitMode.textContent = state.submitMode === "direct"
    ? "Direct submit"
    : "Review before submit";

  if (!ready) {
    elements.pageStatus.textContent = "Add metadata or use sample data to test";
    return;
  }

  if (!enabled) {
    elements.pageStatus.textContent = "Enable Curion below to scan or fill";
  }
}

function truncate(value: any, max = 42) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function renderAnalysis(analysis: AnyRecord | null) {
  const elements = getElements();
  elements.fieldCount.textContent = String(analysis?.fieldCount || 0);
  elements.mappedCount.textContent = String(analysis?.mappedCount || 0);
  elements.fillButton.disabled = !state.autoFillEnabled || !analysis || analysis.mappedCount === 0;
  elements.pageStatus.textContent = analysis?.source
    ? `${analysis.source} mapping · ${Math.round((analysis.overallConfidence || 0) * 100)}%`
    : analysis?.title
      ? analysis.title
      : "Ready to inspect this page";
  elements.mappingList.textContent = "";

  for (const entry of analysis?.mappings || []) {
    const row = document.createElement("div");
    row.className = `mapping-row${entry.mapping ? "" : " is-unmapped"}`;

    const label = document.createElement("strong");
    label.textContent = entry.field.label;

    const value = document.createElement("span");
    if (entry.mapping) {
      const confidence = Math.round(entry.mapping.confidence * 100);
      value.textContent = `${truncate(entry.mapping.value || entry.mapping.key)} · ${confidence}%`;
      value.title = entry.mapping.value || entry.mapping.key;
    } else {
      value.textContent = "No match";
    }

    row.append(label, value);
    elements.mappingList.append(row);
  }
}

function normalizeApiAnalysis(apiAnalysis: AnyRecord) {
  return {
    ...apiAnalysis,
    title: apiAnalysis.title || "Backend mapping complete",
    mappings: apiAnalysis.mappings || []
  };
}

async function sendToActiveTab(message: AnyRecord) {
  const tab = await getActiveTab();
  if (!tab?.id) {
    throw new Error("No active tab found");
  }

  return chrome.tabs.sendMessage(tab.id, message);
}

async function scanPage() {
  const elements = getElements();
  if (!state.autoFillEnabled) {
    elements.pageStatus.textContent = "Auto-fill is off. Enable it in options before scanning.";
    return;
  }

  const useStoredProfile = state.metadataSource !== "working" && Boolean(state.userId);
  if (!useStoredProfile && !hasMetadata(state.activeMetadata)) {
    elements.profileWarning.hidden = false;
    elements.pageStatus.textContent = "Profile data is missing";
    return;
  }

  elements.pageStatus.textContent = "Scanning current page...";

  const pageSnapshot = await sendToActiveTab({ type: "CURION_COLLECT_PAGE" });
  const mappingPayload: AnyRecord = {
    goal: "Fill this page with the active Curion metadata.",
    ...pageSnapshot
  };
  if (useStoredProfile) {
    mappingPayload.userId = state.userId;
  } else {
    mappingPayload.profile = state.activeMetadata;
  }
  const response = await fetch(DEFAULT_API_URL, {
    method: "POST",
    body: JSON.stringify(mappingPayload)
  });

  if (!response.ok) {
    throw new Error(`Backend mapping failed with status ${response.status}`);
  }

  const analysis = normalizeApiAnalysis(await response.json());
  state.analysis = analysis;
  renderAnalysis(analysis);
}

function submitStatusText(result: AnyRecord, noun: string) {
  const filled = result.filledCount || 0;
  if (result.submit?.submitted) {
    return `Filled ${filled} ${noun} and submitted`;
  }
  if (state.submitMode === "direct" && filled > 0) {
    return `Filled ${filled} ${noun}; no form submit target found`;
  }
  return `Filled ${filled} ${noun}`;
}

async function fillPage() {
  const elements = getElements();
  if (!state.autoFillEnabled) {
    elements.pageStatus.textContent = "Auto-fill is off. Enable it in options before filling.";
    return;
  }

  elements.pageStatus.textContent = "Filling matched fields...";

  if (!state.analysis?.source) {
    await scanPage();
  }

  const result = await sendToActiveTab({
    type: "CURION_FILL_MAPPINGS",
    mappings: state.analysis?.mappings || [],
    submitMode: state.submitMode
  });
  elements.pageStatus.textContent = submitStatusText(result, "backend-mapped fields");
}

async function unfillPage() {
  const elements = getElements();
  elements.pageStatus.textContent = "Clearing form fields...";
  const result = await sendToActiveTab({ type: "CURION_UNFILL" });
  state.analysis = null;
  renderAnalysis({ fieldCount: result.fieldCount || 0, mappedCount: 0, mappings: [] });
  elements.pageStatus.textContent = `Cleared ${result.clearedCount || 0} fields`;
}

function openOptions() {
  chrome.runtime.openOptionsPage();
}

async function init() {
  const elements = getElements();
  await loadProfile();

  if (!state.profile) {
    await saveDefaultProfile();
  }

  renderProfileState();
  elements.enableInput.addEventListener("change", () => {
    setCurionEnabled(elements.enableInput.checked).catch(showError);
  });
  elements.scanButton.addEventListener("click", () => scanPage().catch(showError));
  elements.fillButton.addEventListener("click", () => fillPage().catch(showError));
  elements.unfillButton.addEventListener("click", () => unfillPage().catch(showError));
  elements.editProfileButton.addEventListener("click", openOptions);
  elements.openOptionsButton.addEventListener("click", openOptions);
  elements.useSampleButton.addEventListener("click", () => useSampleProfile().catch(showError));
}

function showError(error: any) {
  const elements = getElements();
  elements.pageStatus.textContent = error?.message || "Curion could not access this page";
}

init().catch(showError);
})();
