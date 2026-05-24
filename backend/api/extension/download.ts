const DEFAULT_EXTENSION_DOWNLOAD_URL = "https://curion.sbs/curion-extension.zip";
const DOWNLOAD_FILE_NAME = "curion-extension.zip";

function configuredDownloadUrl() {
  return (
    process.env.CURION_EXTENSION_DOWNLOAD_URL ||
    process.env.curion_extension_download_url ||
    DEFAULT_EXTENSION_DOWNLOAD_URL
  ).trim();
}

function setDownloadHeaders(response, request) {
  const origin = request?.headers?.origin || request?.headers?.Origin || "*";
  const requestedHeaders =
    request?.headers?.["access-control-request-headers"] ||
    request?.headers?.["Access-Control-Request-Headers"] ||
    "Content-Type, Authorization, X-Requested-With, Accept";

  response.setHeader("Access-Control-Allow-Origin", origin);
  response.setHeader("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS");
  response.setHeader("Access-Control-Allow-Headers", requestedHeaders);
  response.setHeader("Access-Control-Max-Age", "86400");
  response.setHeader("Vary", "Origin, Access-Control-Request-Method, Access-Control-Request-Headers");
  response.setHeader("X-Content-Type-Options", "nosniff");
}

function json(response, statusCode, payload) {
  response.status(statusCode).json(payload);
}

export default async function handler(request, response) {
  setDownloadHeaders(response, request);

  if (request.method === "OPTIONS") {
    response.status(200).end();
    return;
  }

  if (request.method !== "GET" && request.method !== "HEAD") {
    response.setHeader("Allow", "GET, HEAD, OPTIONS");
    json(response, 405, { error: "Method not allowed" });
    return;
  }

  try {
    const downloadUrl = new URL(configuredDownloadUrl());
    const packageResponse = await fetch(downloadUrl);

    if (!packageResponse.ok) {
      json(response, 502, {
        error: `Extension package download failed with status ${packageResponse.status}`
      });
      return;
    }

    const contentLength = packageResponse.headers.get("content-length");
    const etag = packageResponse.headers.get("etag");
    const lastModified = packageResponse.headers.get("last-modified");

    response.setHeader("Content-Type", packageResponse.headers.get("content-type") || "application/zip");
    response.setHeader("Content-Disposition", `attachment; filename="${DOWNLOAD_FILE_NAME}"`);
    response.setHeader("Cache-Control", "public, max-age=300");

    if (contentLength) response.setHeader("Content-Length", contentLength);
    if (etag) response.setHeader("ETag", etag);
    if (lastModified) response.setHeader("Last-Modified", lastModified);

    if (request.method === "HEAD") {
      response.status(200).end();
      return;
    }

    const packageBuffer = Buffer.from(await packageResponse.arrayBuffer());
    response.status(200).send(packageBuffer);
  } catch {
    json(response, 500, {
      error: "CURION_EXTENSION_DOWNLOAD_URL must be an absolute URL"
    });
  }
}
