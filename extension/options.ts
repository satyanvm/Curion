(() => {
const SAMPLE_PROFILE: Record<string, string> = {
  name: "Satya Narayan Verma",
  email: "satya@example.com",
  phone: "+91 9876543210",
  company: "Curion",
  jobTitle: "Founder",
  address: "Bengaluru",
  city: "Bengaluru",
  state: "Karnataka",
  postalCode: "560001",
  country: "India",
  linkedin: "https://www.linkedin.com/in/satyanvm/",
  website: "https://curion.sbs",
  preferredContactMethod: "Email",
  notes: "Curion profile for filling repetitive forms with review.",
  acceptTerms: "yes"
};

const DEFAULT_API_URL = "https://backend-three-mu-84.vercel.app/api/agent/map-form";

const form = document.getElementById("profileForm") as any;
const jsonEditor = document.getElementById("jsonEditor") as any;
const workingJsonEditor = document.getElementById("workingJsonEditor") as any;
const userIdInput = document.getElementById("userIdInput") as any;
const backendProfileInput = document.getElementById("backendProfileInput") as any;
const autoFillInput = document.getElementById("autoFillInput") as any;
const submitModeInput = document.getElementById("submitModeInput") as any;
const statusElement = document.getElementById("status") as any;
const workingStats = document.getElementById("workingStats") as any;
const importJsonInput = document.getElementById("importJsonInput") as any;
const saveWorkingJsonButton = document.getElementById("saveWorkingJsonButton") as any;
const useSavedProfileButton = document.getElementById("useSavedProfileButton") as any;
let metadataSource = "saved";

function fields() {
  return Array.from(form.elements).filter((element: any) => element && typeof element.name === "string") as any[];
}

function formToProfile() {
  return Object.fromEntries(fields().map((element: any) => [element.name, element.value.trim()]));
}

function metadataEntries(metadata: any): any[] {
  if (!metadata || typeof metadata !== "object") return [];
  return Object.values(metadata).flatMap((value) => {
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return metadataEntries(value);
    }
    if (value === undefined || value === null || value === "") return [];
    return [value];
  });
}

function hasMetadata(metadata: any) {
  return metadataEntries(metadata).length > 0;
}

function resolveMetadataSource(stored: any) {
  const source = String(stored?.curionMetadataSource || "");
  if (source === "saved" || source === "working") return source;
  return hasMetadata(stored?.curionWorkingMetadata) ? "working" : "saved";
}

function activeProfileForSettings(savedProfile: any, workingMetadata: any) {
  if (metadataSource === "saved") return savedProfile;
  return hasMetadata(workingMetadata) ? workingMetadata : savedProfile;
}

function setStatus(message: string) {
  statusElement.textContent = message;
}

function updateWorkingStats(metadata: any) {
  const count = metadataEntries(metadata).length;
  workingStats.textContent = count ? `${count} active fields` : "Inactive";
}

function isPlainObject(value: any) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function renderMetadataSourceButtons() {
  const usingWorkingMetadata = metadataSource === "working";
  saveWorkingJsonButton.classList.toggle("primary", usingWorkingMetadata);
  useSavedProfileButton.classList.toggle("primary", !usingWorkingMetadata);
  saveWorkingJsonButton.setAttribute("aria-pressed", usingWorkingMetadata ? "true" : "false");
  useSavedProfileButton.setAttribute("aria-pressed", usingWorkingMetadata ? "false" : "true");
}

function render(profile: any) {
  for (const element of fields()) {
    element.value = profile[element.name] || "";
  }
  jsonEditor.value = JSON.stringify(profile, null, 2);
}

function renderWorkingMetadata(metadata: any) {
  const active = metadata && typeof metadata === "object" && metadataEntries(metadata).length > 0;
  workingJsonEditor.value = active ? JSON.stringify(metadata, null, 2) : "";
  updateWorkingStats(active ? metadata : {});
}

async function saveProfile(profile: any) {
  await chrome.storage.local.set({
    curionProfile: profile,
    curionUserId: userIdInput.value.trim(),
    curionUseBackendProfile: backendProfileInput.checked,
    curionAutoFillEnabled: autoFillInput.checked,
    curionSubmitMode: submitModeInput.value
  });
  render(profile);
  setStatus("Profile and behavior settings saved locally.");
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
  metadataSource = resolveMetadataSource(stored);
  userIdInput.value = stored.curionUserId || "";
  backendProfileInput.checked = Boolean(stored.curionUseBackendProfile);
  autoFillInput.checked = Boolean(stored.curionAutoFillEnabled);
  submitModeInput.value = stored.curionSubmitMode || "review";
  render(stored.curionProfile || SAMPLE_PROFILE);
  renderWorkingMetadata(stored.curionWorkingMetadata);
  renderMetadataSourceButtons();
}

async function saveBehaviorSettings() {
  await chrome.storage.local.set({
    curionUserId: userIdInput.value.trim(),
    curionUseBackendProfile: backendProfileInput.checked,
    curionAutoFillEnabled: autoFillInput.checked,
    curionSubmitMode: submitModeInput.value,
    curionMetadataSource: metadataSource
  });
  setStatus("Behavior settings saved.");
}

function ingestUrlFromMappingUrl(mappingUrl: string) {
  const trimmed = String(mappingUrl || "").trim();
  if (!trimmed) return "";
  if (trimmed.endsWith("/api/agent/map-form")) {
    return `${trimmed.slice(0, -"/api/agent/map-form".length)}/api/profile/ingest`;
  }
  return trimmed.replace(/\/agent\/map-form\/?$/, "/profile/ingest");
}

async function syncBackendProfile() {
  const userId = userIdInput.value.trim();
  if (!userId) {
    throw new Error("Backend profile user ID is required.");
  }

  const ingestUrl = ingestUrlFromMappingUrl(DEFAULT_API_URL);
  if (!ingestUrl) {
    throw new Error("Backend endpoint is not configured.");
  }

  const workingMetadata = workingJsonEditor.value.trim()
    ? JSON.parse(workingJsonEditor.value)
    : {};
  const profile = activeProfileForSettings(formToProfile(), workingMetadata);

  setStatus(`Syncing profile atoms to backend: ${ingestUrl}`);
  const result = await new Promise<any>((resolve, reject) => {
    chrome.runtime.sendMessage(
      {
        type: "CURION_SYNC_BACKEND_PROFILE",
        userId,
        profile
      },
      (response: any) => {
        const error = chrome.runtime.lastError;
        if (error) {
          reject(new Error(error.message || `Backend sync request failed for ${ingestUrl}`));
          return;
        }
        if (!response?.ok) {
          reject(new Error(response?.error || `Backend sync failed for ${ingestUrl}`));
          return;
        }
        resolve(response.payload || {});
      }
    );
  });

  await chrome.storage.local.set({
    curionUserId: userId,
    curionUseBackendProfile: true,
    curionMetadataSource: metadataSource
  });
  backendProfileInput.checked = true;
  setStatus(`Backend profile synced for ${userId}. ${result.atomCount || 0} atoms stored.`);
}

async function saveWorkingJson() {
  if (!workingJsonEditor.value.trim()) {
    await clearWorkingJson();
    return;
  }

  const parsed = JSON.parse(workingJsonEditor.value);
  if (!isPlainObject(parsed)) {
    throw new Error("Working metadata must be a JSON object.");
  }

  await applyWorkingJson(parsed, "Working metadata is now active.");
  workingJsonEditor.focus();
}

async function applyWorkingJson(parsed: any, statusMessage: string) {
  metadataSource = "working";
  await chrome.storage.local.set({ curionWorkingMetadata: parsed, curionMetadataSource: metadataSource });
  renderWorkingMetadata(parsed);
  renderMetadataSourceButtons();
  setStatus(statusMessage);
}

async function clearWorkingJson() {
  metadataSource = "saved";
  await chrome.storage.local.set({ curionWorkingMetadata: {}, curionMetadataSource: metadataSource });
  renderWorkingMetadata({});
  renderMetadataSourceButtons();
  useSavedProfileButton.focus();
  setStatus("Working metadata cleared. Curion will use the saved profile.");
}

async function useSavedProfile() {
  metadataSource = "saved";
  await chrome.storage.local.set({ curionMetadataSource: metadataSource });
  renderMetadataSourceButtons();
  useSavedProfileButton.focus();
  setStatus("Saved profile is now active.");
}

function exportProfile() {
  const profile = formToProfile();
  const blob = new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "curion-profile.json";
  anchor.click();
  URL.revokeObjectURL(url);
  setStatus("Profile exported.");
}

form.addEventListener("submit", (event: Event) => {
  event.preventDefault();
  saveProfile(formToProfile()).catch((error: any) => setStatus(error.message));
});

document.getElementById("saveJsonButton")?.addEventListener("click", () => {
  try {
    const parsed = JSON.parse(jsonEditor.value);
    saveProfile(parsed).catch((error: any) => setStatus(error.message));
  } catch {
    setStatus("JSON is invalid.");
  }
});

document.getElementById("saveWorkingJsonButton")?.addEventListener("click", () => {
  saveWorkingJson().catch((error: any) => setStatus(error.message || "Working metadata JSON is invalid."));
});

document.getElementById("useSavedProfileButton")?.addEventListener("click", () => {
  useSavedProfile().catch((error: any) => setStatus(error.message));
});

document.getElementById("clearWorkingJsonButton")?.addEventListener("click", () => {
  clearWorkingJson().catch((error: any) => setStatus(error.message));
});

workingJsonEditor.addEventListener("blur", () => {
  const raw = workingJsonEditor.value.trim();
  if (!raw) return;

  try {
    const parsed = JSON.parse(raw);
    if (!isPlainObject(parsed)) return;
    applyWorkingJson(parsed, "Working JSON updated.").catch((error: any) => setStatus(error.message));
  } catch {
    // Leave invalid JSON for manual correction.
  }
});

workingJsonEditor.addEventListener("paste", () => {
  window.setTimeout(() => {
    const raw = workingJsonEditor.value.trim();
    if (!raw) return;

    try {
      const parsed = JSON.parse(raw);
      if (!isPlainObject(parsed)) return;
      applyWorkingJson(parsed, "Working JSON pasted and activated.").catch((error: any) => setStatus(error.message));
    } catch {
      // Ignore invalid paste content until the user saves explicitly.
    }
  }, 0);
});

document.getElementById("loadSampleButton")?.addEventListener("click", () => {
  render(SAMPLE_PROFILE);
  setStatus("Sample loaded. Save when ready.");
});

document.getElementById("exportJsonButton")?.addEventListener("click", exportProfile);

autoFillInput.addEventListener("change", () => {
  saveBehaviorSettings().catch((error: any) => setStatus(error.message));
});

submitModeInput.addEventListener("change", () => {
  saveBehaviorSettings().catch((error: any) => setStatus(error.message));
});

backendProfileInput.addEventListener("change", () => {
  saveBehaviorSettings().catch((error: any) => setStatus(error.message));
});

userIdInput.addEventListener("change", () => {
  saveBehaviorSettings().catch((error: any) => setStatus(error.message));
});

document.getElementById("syncBackendButton")?.addEventListener("click", () => {
  syncBackendProfile().catch((error: any) => setStatus(error.message || "Backend sync failed."));
});

document.getElementById("copyJsonButton")?.addEventListener("click", () => {
  navigator.clipboard.writeText(jsonEditor.value).then(
    () => setStatus("JSON copied."),
    () => setStatus("Copy failed.")
  );
});

importJsonInput.addEventListener("change", async () => {
  const file = importJsonInput.files?.[0];
  importJsonInput.value = "";
  if (!file) return;

  try {
    const parsed = JSON.parse(await file.text());
    await saveProfile(parsed);
  } catch {
    setStatus("Import failed. Use a valid JSON file.");
  }
});

for (const element of fields() as any[]) {
  element.addEventListener("input", () => {
    jsonEditor.value = JSON.stringify(formToProfile(), null, 2);
  });
}

loadProfile().catch((error: any) => setStatus(error.message));
})();
