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
const apiUrlInput = document.getElementById("apiUrlInput");
const statusElement = document.getElementById("status");

function fields() {
  return Array.from(form.elements).filter((element) => element.name);
}

function formToProfile() {
  return Object.fromEntries(fields().map((element) => [element.name, element.value.trim()]));
}

function setStatus(message) {
  statusElement.textContent = message;
}

function render(profile) {
  for (const element of fields()) {
    element.value = profile[element.name] || "";
  }
  jsonEditor.value = JSON.stringify(profile, null, 2);
}

async function saveProfile(profile) {
  await chrome.storage.local.set({
    curionProfile: profile,
    curionApiUrl: apiUrlInput.value.trim()
  });
  render(profile);
  setStatus("Profile saved locally.");
}

async function loadProfile() {
  const stored = await chrome.storage.local.get(["curionProfile", "curionApiUrl"]);
  apiUrlInput.value = stored.curionApiUrl || DEFAULT_API_URL;
  render(stored.curionProfile || SAMPLE_PROFILE);
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

document.getElementById("loadSampleButton").addEventListener("click", () => {
  render(SAMPLE_PROFILE);
  setStatus("Sample loaded. Save when ready.");
});

document.getElementById("copyJsonButton").addEventListener("click", () => {
  navigator.clipboard.writeText(jsonEditor.value).then(
    () => setStatus("JSON copied."),
    () => setStatus("Copy failed.")
  );
});

for (const element of fields()) {
  element.addEventListener("input", () => {
    jsonEditor.value = JSON.stringify(formToProfile(), null, 2);
  });
}

loadProfile().catch((error) => setStatus(error.message));
