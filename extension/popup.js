const DEFAULT_PROFILE = {
  name: "Satya Narayan Verma",
  email: "",
  phone: "",
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

const state = {
  profile: null,
  workingMetadata: {},
  activeMetadata: null,
  apiUrl: "",
  submitMode: "review",
  autoFillEnabled: false,
  analysis: null
};

function getElements() {
  return {
    pageStatus: document.getElementById("pageStatus"),
    fieldCount: document.getElementById("fieldCount"),
    mappedCount: document.getElementById("mappedCount"),
    scanButton: document.getElementById("scanButton"),
    fillButton: document.getElementById("fillButton"),
    unfillButton: document.getElementById("unfillButton"),
    profileWarning: document.getElementById("profileWarning"),
    metadataMode: document.getElementById("metadataMode"),
    submitMode: document.getElementById("submitMode"),
    mappingList: document.getElementById("mappingList"),
    editProfileButton: document.getElementById("editProfileButton"),
    openOptionsButton: document.getElementById("openOptionsButton")
  };
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

function hasMetadata(metadata) {
  return metadataEntries(metadata).length > 0;
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function loadProfile() {
  const stored = await chrome.storage.local.get([
    "curionProfile",
    "curionWorkingMetadata",
    "curionApiUrl",
    "curionAutoFillEnabled",
    "curionSubmitMode"
  ]);

  state.profile = stored.curionProfile || null;
  state.workingMetadata = stored.curionWorkingMetadata && typeof stored.curionWorkingMetadata === "object"
    ? stored.curionWorkingMetadata
    : {};
  state.activeMetadata = hasMetadata(state.workingMetadata) ? state.workingMetadata : state.profile;
  state.apiUrl = stored.curionApiUrl || DEFAULT_API_URL;
  state.submitMode = stored.curionSubmitMode || "review";
  state.autoFillEnabled = Boolean(stored.curionAutoFillEnabled);
  return state.activeMetadata;
}

async function saveDefaultProfile() {
  await chrome.storage.local.set({ curionProfile: DEFAULT_PROFILE });
  state.profile = DEFAULT_PROFILE;
  state.activeMetadata = hasMetadata(state.workingMetadata) ? state.workingMetadata : state.profile;
}

function renderProfileState() {
  const elements = getElements();
  const ready = hasMetadata(state.activeMetadata);
  const usingWorkingMetadata = hasMetadata(state.workingMetadata);
  const enabled = state.autoFillEnabled;

  elements.profileWarning.hidden = ready;
  elements.scanButton.disabled = !ready || !enabled;
  elements.fillButton.disabled = true;
  elements.metadataMode.textContent = `${usingWorkingMetadata ? "Working metadata" : "Saved profile"}${
    enabled ? " · enabled" : " · off"
  }`;
  elements.submitMode.textContent = state.submitMode === "direct"
    ? "Direct submit"
    : "Review before submit";

  if (!ready) {
    elements.pageStatus.textContent = "Add profile data before filling forms";
    return;
  }

  if (!enabled) {
    elements.pageStatus.textContent = "Turn on auto-fill in options to scan or fill";
  }
}

function truncate(value, max = 42) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max - 1)}...` : text;
}

function renderAnalysis(analysis) {
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

function normalizeApiAnalysis(apiAnalysis) {
  return {
    ...apiAnalysis,
    title: apiAnalysis.title || "Backend mapping complete",
    mappings: apiAnalysis.mappings || []
  };
}

async function sendToActiveTab(message) {
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

  if (!hasMetadata(state.activeMetadata)) {
    elements.profileWarning.hidden = false;
    elements.pageStatus.textContent = "Profile data is missing";
    return;
  }

  elements.pageStatus.textContent = "Scanning current page...";

  if (state.apiUrl) {
    try {
      const pageSnapshot = await sendToActiveTab({ type: "CURION_COLLECT_PAGE" });
      const response = await fetch(state.apiUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          goal: "Fill this page with the active Curion metadata.",
          ...pageSnapshot,
          profile: state.activeMetadata
        })
      });

      if (!response.ok) {
        throw new Error(`Backend mapping failed with status ${response.status}`);
      }

      const analysis = normalizeApiAnalysis(await response.json());
      state.analysis = analysis;
      renderAnalysis(analysis);
      return;
    } catch {
      elements.pageStatus.textContent = "Backend unavailable; using local matching";
    }
  }

  const analysis = await sendToActiveTab({
    type: "CURION_ANALYZE",
    profile: state.activeMetadata
  });
  state.analysis = analysis;
  renderAnalysis(analysis);
}

function submitStatusText(result, noun) {
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

  if (state.analysis?.source) {
    const result = await sendToActiveTab({
      type: "CURION_FILL_MAPPINGS",
      mappings: state.analysis.mappings || [],
      submitMode: state.submitMode
    });
    elements.pageStatus.textContent = submitStatusText(result, "backend-mapped fields");
    return;
  }

  const result = await sendToActiveTab({
    type: "CURION_FILL",
    profile: state.activeMetadata,
    submitMode: state.submitMode
  });
  state.analysis = result;
  renderAnalysis(result);
  elements.pageStatus.textContent = submitStatusText(result, "fields");
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
  elements.scanButton.addEventListener("click", () => scanPage().catch(showError));
  elements.fillButton.addEventListener("click", () => fillPage().catch(showError));
  elements.unfillButton.addEventListener("click", () => unfillPage().catch(showError));
  elements.editProfileButton.addEventListener("click", openOptions);
  elements.openOptionsButton.addEventListener("click", openOptions);
}

function showError(error) {
  const elements = getElements();
  elements.pageStatus.textContent = error?.message || "Curion could not access this page";
}

init().catch(showError);
