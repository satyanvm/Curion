(() => {
const DEFAULT_API_URL = "https://backend-three-mu-84.vercel.app/api/agent/map-form";

function ingestUrlFromMappingUrl(mappingUrl) {
  const trimmed = String(mappingUrl || "").trim();
  if (!trimmed) return "";
  if (trimmed.endsWith("/api/agent/map-form")) {
    return `${trimmed.slice(0, -"/api/agent/map-form".length)}/api/profile/ingest`;
  }
  return trimmed.replace(/\/agent\/map-form\/?$/, "/profile/ingest");
}

function toJsonPayload(payload) {
  return JSON.stringify(payload);
}

async function syncBackendProfile(request) {
  const userId = String(request?.userId || "").trim();
  if (!userId) {
    throw new Error("Backend profile user ID is required.");
  }

  const ingestUrl = ingestUrlFromMappingUrl(DEFAULT_API_URL);
  if (!ingestUrl) {
    throw new Error("Backend endpoint is not configured.");
  }

  const response = await fetch(ingestUrl, {
    method: "POST",
    headers: {
      "Content-Type": "text/plain;charset=UTF-8"
    },
    body: toJsonPayload({
      userId,
      profile: request?.profile || {}
    })
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `Backend sync failed with status ${response.status}`);
  }

  return payload;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "CURION_SYNC_BACKEND_PROFILE") {
    syncBackendProfile(message)
      .then((payload) => sendResponse({ ok: true, payload }))
      .catch((error) => sendResponse({ ok: false, error: error?.message || "Backend sync failed" }));
    return true;
  }

  return false;
});
})();
