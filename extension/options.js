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
    const autoFillInput = document.getElementById("autoFillInput");
    const submitModeInput = document.getElementById("submitModeInput");
    const statusElement = document.getElementById("status");
    const workingStats = document.getElementById("workingStats");
    const saveWorkingJsonButton = document.getElementById("saveWorkingJsonButton");
    const useSavedProfileButton = document.getElementById("useSavedProfileButton");
    const profileViewButton = document.getElementById("profileViewButton");
    const backToJsonButton = document.getElementById("backToJsonButton");
    const jsonView = document.getElementById("jsonView");
    const profileView = document.getElementById("profileView");
    let metadataSource = "working";
    submitModeInput.value = "review";
    function resolveSubmitMode(value) {
        const mode = String(value || "");
        return mode === "direct" || mode === "workflow" ? mode : "review";
    }
    function fields() {
        return Array.from(form.elements).filter((element) => {
            return element && typeof element.name === "string" && element.name.trim();
        });
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
        return "working";
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
    function flashButton(button) {
        button.classList.remove("is-clicked");
        void button.offsetWidth;
        button.classList.add("is-clicked");
        window.setTimeout(() => button.classList.remove("is-clicked"), 180);
    }
    function parseJsonEditor() {
        const parsed = JSON.parse(jsonEditor.value);
        if (!isPlainObject(parsed)) {
            throw new Error("JSON must be an object.");
        }
        return parsed;
    }
    function renderMetadataSourceButtons() {
        const usingWorkingMetadata = metadataSource === "working";
        saveWorkingJsonButton.setAttribute("aria-pressed", usingWorkingMetadata ? "true" : "false");
        useSavedProfileButton.setAttribute("aria-pressed", usingWorkingMetadata ? "false" : "true");
    }
    function renderProfileForm(profile) {
        for (const element of fields()) {
            element.value = profile[element.name] || "";
        }
    }
    function render(profile) {
        renderProfileForm(profile);
        jsonEditor.value = JSON.stringify(profile, null, 2);
    }
    function renderWorkingMetadata(metadata) {
        const active = metadata && typeof metadata === "object" && metadataEntries(metadata).length > 0;
        updateWorkingStats(active ? metadata : {});
    }
    function showJsonView() {
        jsonEditor.value = JSON.stringify(formToProfile(), null, 2);
        jsonView.hidden = false;
        profileView.hidden = true;
        profileViewButton.hidden = false;
        backToJsonButton.hidden = true;
        jsonEditor.focus();
    }
    function showProfileView() {
        try {
            renderProfileForm(parseJsonEditor());
        }
        catch {
            setStatus("JSON is invalid. Showing the current profile fields.");
        }
        jsonView.hidden = true;
        profileView.hidden = false;
        profileViewButton.hidden = true;
        backToJsonButton.hidden = false;
        form.querySelector("input, textarea, select")?.focus();
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
    async function savedProfileUserId() {
        const stored = await chrome.storage.local.get(["curionUserId"]);
        const existing = String(stored.curionUserId || "").trim();
        if (existing)
            return existing;
        const generated = `curion_${crypto.randomUUID()}`;
        await chrome.storage.local.set({ curionUserId: generated });
        return generated;
    }
    async function syncSavedProfile(profile, userId) {
        const ingestUrl = ingestUrlFromMappingUrl(DEFAULT_API_URL);
        if (!ingestUrl) {
            throw new Error("Backend endpoint is not configured.");
        }
        const response = await fetch(ingestUrl, {
            method: "POST",
            headers: {
                "Content-Type": "text/plain;charset=UTF-8"
            },
            body: JSON.stringify({ userId, profile })
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(payload.error || `Backend profile save failed with status ${response.status}`);
        }
        return payload;
    }
    async function saveProfile(profile) {
        const userId = await savedProfileUserId();
        setStatus("Saving profile to backend...");
        const result = await syncSavedProfile(profile, userId);
        metadataSource = "saved";
        await chrome.storage.local.set({
            curionProfile: profile,
            curionUserId: userId,
            curionUseBackendProfile: true,
            curionAutoFillEnabled: autoFillInput.checked,
            curionSubmitMode: resolveSubmitMode(submitModeInput.value),
            curionMetadataSource: metadataSource
        });
        render(profile);
        renderMetadataSourceButtons();
        setStatus(`Saved profile is active. ${result.atomCount || 0} backend atoms stored.`);
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
        autoFillInput.checked = Boolean(stored.curionAutoFillEnabled);
        submitModeInput.value = resolveSubmitMode(stored.curionSubmitMode);
        if (stored.curionSubmitMode !== submitModeInput.value) {
            await chrome.storage.local.set({ curionSubmitMode: submitModeInput.value });
        }
        render(stored.curionProfile || SAMPLE_PROFILE);
        renderWorkingMetadata(stored.curionWorkingMetadata);
        renderMetadataSourceButtons();
    }
    async function saveBehaviorSettings() {
        await chrome.storage.local.set({
            curionAutoFillEnabled: autoFillInput.checked,
            curionSubmitMode: resolveSubmitMode(submitModeInput.value),
            curionMetadataSource: metadataSource
        });
        setStatus("Behavior settings saved.");
    }
    async function saveWorkingJson() {
        if (!jsonEditor.value.trim()) {
            await clearWorkingJson();
            return;
        }
        const parsed = parseJsonEditor();
        await applyWorkingJson(parsed, "Working metadata is now active.");
        jsonEditor.focus();
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
        await saveProfile(parseJsonEditor());
        useSavedProfileButton.focus();
    }
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        saveProfile(formToProfile()).catch((error) => setStatus(error.message));
    });
    document.getElementById("saveJsonButton")?.addEventListener("click", () => {
        try {
            const parsed = parseJsonEditor();
            saveProfile(parsed).catch((error) => setStatus(error.message));
        }
        catch (error) {
            setStatus(error.message || "JSON is invalid.");
        }
    });
    document.getElementById("saveWorkingJsonButton")?.addEventListener("click", () => {
        saveWorkingJson().catch((error) => setStatus(error.message || "Working metadata JSON is invalid."));
    });
    document.getElementById("useSavedProfileButton")?.addEventListener("click", () => {
        useSavedProfile().catch((error) => setStatus(error.message || "JSON is invalid."));
    });
    profileViewButton.addEventListener("click", showProfileView);
    backToJsonButton.addEventListener("click", showJsonView);
    autoFillInput.addEventListener("change", () => {
        saveBehaviorSettings().catch((error) => setStatus(error.message));
    });
    submitModeInput.addEventListener("change", () => {
        saveBehaviorSettings().catch((error) => setStatus(error.message));
    });
    document.getElementById("copyJsonButton")?.addEventListener("click", () => {
        navigator.clipboard.writeText(jsonEditor.value).then(() => setStatus("JSON copied."), () => setStatus("Copy failed."));
    });
    document.addEventListener("click", (event) => {
        const button = event.target?.closest?.("button");
        if (button)
            flashButton(button);
    });
    for (const element of fields()) {
        element.addEventListener("input", () => {
            jsonEditor.value = JSON.stringify(formToProfile(), null, 2);
        });
    }
    loadProfile().catch((error) => setStatus(error.message));
})();
