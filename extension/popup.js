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
  apiUrl: "",
  analysis: null
};

function getElements() {
  return {
    pageStatus: document.getElementById("pageStatus"),
    fieldCount: document.getElementById("fieldCount"),
    mappedCount: document.getElementById("mappedCount"),
    scanButton: document.getElementById("scanButton"),
    fillButton: document.getElementById("fillButton"),
    profileWarning: document.getElementById("profileWarning"),
    mappingList: document.getElementById("mappingList"),
    editProfileButton: document.getElementById("editProfileButton"),
    openOptionsButton: document.getElementById("openOptionsButton")
  };
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

async function loadProfile() {
  const stored = await chrome.storage.local.get(["curionProfile", "curionApiUrl"]);
  state.profile = stored.curionProfile || null;
  state.apiUrl = stored.curionApiUrl || DEFAULT_API_URL;
  return state.profile;
}

function hasProfile(profile) {
  return Boolean(profile && Object.values(profile).some((value) => String(value || "").trim()));
}

async function saveDefaultProfile() {
  await chrome.storage.local.set({ curionProfile: DEFAULT_PROFILE });
  state.profile = DEFAULT_PROFILE;
}

function renderAnalysis(analysis) {
  const elements = getElements();
  elements.fieldCount.textContent = String(analysis?.fieldCount || 0);
  elements.mappedCount.textContent = String(analysis?.mappedCount || 0);
  elements.fillButton.disabled = !analysis || analysis.mappedCount === 0;
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
    value.textContent = entry.mapping
      ? `${entry.mapping.key} · ${Math.round(entry.mapping.confidence * 100)}%`
      : "No match";

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
  if (!hasProfile(state.profile)) {
    elements.profileWarning.hidden = false;
    elements.pageStatus.textContent = "Profile data is missing";
    return;
  }

  elements.pageStatus.textContent = "Scanning current page...";

  if (state.apiUrl) {
    const pageSnapshot = await sendToActiveTab({
      type: "CURION_COLLECT_PAGE"
    });
    const response = await fetch(state.apiUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        goal: "Fill this page with the saved Curion profile.",
        ...pageSnapshot,
        profile: state.profile
      })
    });

    if (!response.ok) {
      throw new Error(`Backend mapping failed with status ${response.status}`);
    }

    const analysis = normalizeApiAnalysis(await response.json());
    state.analysis = analysis;
    renderAnalysis(analysis);
    return;
  }

  const analysis = await sendToActiveTab({
    type: "CURION_ANALYZE",
    profile: state.profile
  });
  state.analysis = analysis;
  renderAnalysis(analysis);
}

async function fillPage() {
  const elements = getElements();
  elements.pageStatus.textContent = "Filling matched fields...";

  if (state.analysis?.source) {
    const result = await sendToActiveTab({
      type: "CURION_FILL_MAPPINGS",
      mappings: state.analysis.mappings || []
    });
    elements.pageStatus.textContent = `Filled ${result.filledCount || 0} backend-mapped fields`;
    return;
  }

  const result = await sendToActiveTab({
    type: "CURION_FILL",
    profile: state.profile
  });
  state.analysis = result;
  renderAnalysis(result);
  elements.pageStatus.textContent = `Filled ${result.filledCount || 0} fields`;
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

  elements.profileWarning.hidden = hasProfile(state.profile);
  elements.scanButton.addEventListener("click", () => scanPage().catch(showError));
  elements.fillButton.addEventListener("click", () => fillPage().catch(showError));
  elements.editProfileButton.addEventListener("click", openOptions);
  elements.openOptionsButton.addEventListener("click", openOptions);
}

function showError(error) {
  const elements = getElements();
  elements.pageStatus.textContent = error?.message || "Curion could not access this page";
}

init().catch(showError);
