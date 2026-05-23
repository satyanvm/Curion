(() => {
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
        website: "https://curion.sbs",
        preferredContactMethod: "Email",
        notes: "Curion profile for filling repetitive forms with review.",
        acceptTerms: "yes"
    };
    const DEFAULT_API_URL = "https://backend-three-mu-84.vercel.app/api/agent/map-form";
    const form = document.getElementById("profileForm");
    const jsonEditor = document.getElementById("jsonEditor");
    const workingJsonEditor = document.getElementById("workingJsonEditor");
    const apiUrlInput = document.getElementById("apiUrlInput");
    const userIdInput = document.getElementById("userIdInput");
    const backendProfileInput = document.getElementById("backendProfileInput");
    const autoFillInput = document.getElementById("autoFillInput");
    const submitModeInput = document.getElementById("submitModeInput");
    const statusElement = document.getElementById("status");
    const workingStats = document.getElementById("workingStats");
    const importJsonInput = document.getElementById("importJsonInput");
    const saveWorkingJsonButton = document.getElementById("saveWorkingJsonButton");
    const useSavedProfileButton = document.getElementById("useSavedProfileButton");
    let metadataSource = "saved";
    function fields() {
        return Array.from(form.elements).filter((element) => element && typeof element.name === "string");
    }
    function formToProfile() {
        return Object.fromEntries(fields().map((element) => [element.name, element.value.trim()]));
    }
    function metadataEntries(metadata) {
        if (!metadata || typeof metadata !== "object")
            return [];
        return Object.values(metadata).flatMap((value) => {
            if (value && typeof value === "object" && !Array.isArray(value)) {
                return metadataEntries(value);
            }
            if (value === undefined || value === null || value === "")
                return [];
            return [value];
        });
    }
    function hasMetadata(metadata) {
        return metadataEntries(metadata).length > 0;
    }
    function resolveMetadataSource(stored) {
        const source = String(stored?.curionMetadataSource || "");
        if (source === "saved" || source === "working")
            return source;
        return hasMetadata(stored?.curionWorkingMetadata) ? "working" : "saved";
    }
    function activeProfileForSettings(savedProfile, workingMetadata) {
        if (metadataSource === "saved")
            return savedProfile;
        return hasMetadata(workingMetadata) ? workingMetadata : savedProfile;
    }
    function setStatus(message) {
        statusElement.textContent = message;
    }
    function updateWorkingStats(metadata) {
        const count = metadataEntries(metadata).length;
        workingStats.textContent = count ? `${count} active fields` : "Inactive";
    }
    function isPlainObject(value) {
        return Boolean(value) && typeof value === "object" && !Array.isArray(value);
    }
    function renderMetadataSourceButtons() {
        const usingWorkingMetadata = metadataSource === "working";
        saveWorkingJsonButton.classList.toggle("primary", usingWorkingMetadata);
        useSavedProfileButton.classList.toggle("primary", !usingWorkingMetadata);
        saveWorkingJsonButton.setAttribute("aria-pressed", usingWorkingMetadata ? "true" : "false");
        useSavedProfileButton.setAttribute("aria-pressed", usingWorkingMetadata ? "false" : "true");
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
            "curionApiUrl",
            "curionUserId",
            "curionUseBackendProfile",
            "curionAutoFillEnabled",
            "curionSubmitMode"
        ]);
        metadataSource = resolveMetadataSource(stored);
        apiUrlInput.value = stored.curionApiUrl || DEFAULT_API_URL;
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
            curionApiUrl: apiUrlInput.value.trim(),
            curionUseBackendProfile: backendProfileInput.checked,
            curionAutoFillEnabled: autoFillInput.checked,
            curionSubmitMode: submitModeInput.value,
            curionMetadataSource: metadataSource
        });
        setStatus("Behavior settings saved.");
    }
    function ingestUrlFromMappingUrl(mappingUrl) {
        const trimmed = String(mappingUrl || "").trim();
        if (!trimmed)
            return "";
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
        const ingestUrl = ingestUrlFromMappingUrl(apiUrlInput.value || DEFAULT_API_URL);
        if (!ingestUrl) {
            throw new Error("Backend API URL is required.");
        }
        const workingMetadata = workingJsonEditor.value.trim()
            ? JSON.parse(workingJsonEditor.value)
            : {};
        const profile = activeProfileForSettings(formToProfile(), workingMetadata);
        setStatus(`Syncing profile atoms to backend: ${ingestUrl}`);
        const result = await new Promise((resolve, reject) => {
            chrome.runtime.sendMessage({
                type: "CURION_SYNC_BACKEND_PROFILE",
                apiUrl: apiUrlInput.value.trim() || DEFAULT_API_URL,
                userId,
                profile
            }, (response) => {
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
            });
        });
        await chrome.storage.local.set({
            curionUserId: userId,
            curionApiUrl: apiUrlInput.value.trim(),
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
        saveWorkingJsonButton.focus();
    }
    async function applyWorkingJson(parsed, statusMessage) {
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
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        saveProfile(formToProfile()).catch((error) => setStatus(error.message));
    });
    document.getElementById("saveJsonButton")?.addEventListener("click", () => {
        try {
            const parsed = JSON.parse(jsonEditor.value);
            saveProfile(parsed).catch((error) => setStatus(error.message));
        }
        catch {
            setStatus("JSON is invalid.");
        }
    });
    document.getElementById("saveWorkingJsonButton")?.addEventListener("click", () => {
        saveWorkingJson().catch((error) => setStatus(error.message || "Working metadata JSON is invalid."));
    });
    document.getElementById("useSavedProfileButton")?.addEventListener("click", () => {
        useSavedProfile().catch((error) => setStatus(error.message));
    });
    document.getElementById("clearWorkingJsonButton")?.addEventListener("click", () => {
        clearWorkingJson().catch((error) => setStatus(error.message));
    });
    workingJsonEditor.addEventListener("blur", () => {
        const raw = workingJsonEditor.value.trim();
        if (!raw)
            return;
        try {
            const parsed = JSON.parse(raw);
            if (!isPlainObject(parsed))
                return;
            applyWorkingJson(parsed, "Working JSON updated.").catch((error) => setStatus(error.message));
        }
        catch {
            // Leave invalid JSON for manual correction.
        }
    });
    workingJsonEditor.addEventListener("paste", () => {
        window.setTimeout(() => {
            const raw = workingJsonEditor.value.trim();
            if (!raw)
                return;
            try {
                const parsed = JSON.parse(raw);
                if (!isPlainObject(parsed))
                    return;
                applyWorkingJson(parsed, "Working JSON pasted and activated.").catch((error) => setStatus(error.message));
            }
            catch {
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
        saveBehaviorSettings().catch((error) => setStatus(error.message));
    });
    submitModeInput.addEventListener("change", () => {
        saveBehaviorSettings().catch((error) => setStatus(error.message));
    });
    backendProfileInput.addEventListener("change", () => {
        saveBehaviorSettings().catch((error) => setStatus(error.message));
    });
    userIdInput.addEventListener("change", () => {
        saveBehaviorSettings().catch((error) => setStatus(error.message));
    });
    apiUrlInput.addEventListener("change", () => {
        saveBehaviorSettings().catch((error) => setStatus(error.message));
    });
    document.getElementById("syncBackendButton")?.addEventListener("click", () => {
        syncBackendProfile().catch((error) => setStatus(error.message || "Backend sync failed."));
    });
    document.getElementById("copyJsonButton")?.addEventListener("click", () => {
        navigator.clipboard.writeText(jsonEditor.value).then(() => setStatus("JSON copied."), () => setStatus("Copy failed."));
    });
    importJsonInput.addEventListener("change", async () => {
        const file = importJsonInput.files?.[0];
        importJsonInput.value = "";
        if (!file)
            return;
        try {
            const parsed = JSON.parse(await file.text());
            await saveProfile(parsed);
        }
        catch {
            setStatus("Import failed. Use a valid JSON file.");
        }
    });
    for (const element of fields()) {
        element.addEventListener("input", () => {
            jsonEditor.value = JSON.stringify(formToProfile(), null, 2);
        });
    }
    loadProfile().catch((error) => setStatus(error.message));
})();
