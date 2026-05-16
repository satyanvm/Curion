const SAMPLE_PROFILE = {
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
  website: "https://curion.website",
  preferredContactMethod: "Email",
  notes: "Curion profile for filling repetitive forms with review.",
  acceptTerms: "yes"
};

const DEFAULT_API_URL = "https://backend-three-mu-84.vercel.app/api/agent/map-form";

const form = document.getElementById("profileForm");
const jsonEditor = document.getElementById("jsonEditor");
const workingJsonEditor = document.getElementById("workingJsonEditor");
const apiUrlInput = document.getElementById("apiUrlInput");
const autoFillInput = document.getElementById("autoFillInput");
const submitModeInput = document.getElementById("submitModeInput");
const statusElement = document.getElementById("status");
const workingStats = document.getElementById("workingStats");
const importJsonInput = document.getElementById("importJsonInput");

function fields() {
  return Array.from(form.elements).filter((element) => element.name);
}

function formToProfile() {
  return Object.fromEntries(fields().map((element) => [element.name, element.value.trim()]));
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

function setStatus(message) {
  statusElement.textContent = message;
}

function updateWorkingStats(metadata) {
  const count = metadataEntries(metadata).length;
  workingStats.textContent = count ? `${count} active fields` : "Inactive";
}

function render(profile) {
  for (const element of fields()) {
    element.value = profile[element.name] || "";
  }
  jsonEditor.value = JSON.stringify(profile, null, 2);
}

function renderWorkingMetadata(metadata) {
  const active = metadata && typeof metadata === "object" && metadataEntries(metadata).length > 0;
  workingJsonEditor.value = active ? JSON.stringify(metadata, null, 2) : "";
  updateWorkingStats(active ? metadata : {});
}

async function saveProfile(profile) {
  await chrome.storage.local.set({
    curionProfile: profile,
    curionApiUrl: apiUrlInput.value.trim(),
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
    "curionApiUrl",
    "curionAutoFillEnabled",
    "curionSubmitMode"
  ]);
  apiUrlInput.value = stored.curionApiUrl || DEFAULT_API_URL;
  autoFillInput.checked = Boolean(stored.curionAutoFillEnabled);
  submitModeInput.value = stored.curionSubmitMode || "review";
  render(stored.curionProfile || SAMPLE_PROFILE);
  renderWorkingMetadata(stored.curionWorkingMetadata);
}

async function saveBehaviorSettings() {
  await chrome.storage.local.set({
    curionAutoFillEnabled: autoFillInput.checked,
    curionSubmitMode: submitModeInput.value
  });
  setStatus("Behavior settings saved.");
}

async function saveWorkingJson() {
  if (!workingJsonEditor.value.trim()) {
    await clearWorkingJson();
    return;
  }

  const parsed = JSON.parse(workingJsonEditor.value);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Working metadata must be a JSON object.");
  }

  await chrome.storage.local.set({ curionWorkingMetadata: parsed });
  renderWorkingMetadata(parsed);
  setStatus("Working metadata is now active.");
}

async function clearWorkingJson() {
  await chrome.storage.local.set({ curionWorkingMetadata: {} });
  renderWorkingMetadata({});
  setStatus("Working metadata cleared. Curion will use the saved profile.");
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

form.addEventListener("submit", (event) => {
  event.preventDefault();
  saveProfile(formToProfile()).catch((error) => setStatus(error.message));
});

document.getElementById("saveJsonButton").addEventListener("click", () => {
  try {
    const parsed = JSON.parse(jsonEditor.value);
    saveProfile(parsed).catch((error) => setStatus(error.message));
  } catch (error) {
    setStatus("JSON is invalid.");
  }
});

document.getElementById("saveWorkingJsonButton").addEventListener("click", () => {
  saveWorkingJson().catch((error) => setStatus(error.message || "Working metadata JSON is invalid."));
});

document.getElementById("clearWorkingJsonButton").addEventListener("click", () => {
  clearWorkingJson().catch((error) => setStatus(error.message));
});

document.getElementById("loadSampleButton").addEventListener("click", () => {
  render(SAMPLE_PROFILE);
  setStatus("Sample loaded. Save when ready.");
});

document.getElementById("exportJsonButton").addEventListener("click", exportProfile);

autoFillInput.addEventListener("change", () => {
  saveBehaviorSettings().catch((error) => setStatus(error.message));
});

submitModeInput.addEventListener("change", () => {
  saveBehaviorSettings().catch((error) => setStatus(error.message));
});

document.getElementById("copyJsonButton").addEventListener("click", () => {
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

for (const element of fields()) {
  element.addEventListener("input", () => {
    jsonEditor.value = JSON.stringify(formToProfile(), null, 2);
  });
}

loadProfile().catch((error) => setStatus(error.message));
