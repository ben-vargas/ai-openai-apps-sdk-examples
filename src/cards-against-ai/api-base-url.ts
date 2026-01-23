const DEFAULT_API_BASE_URL = "http://localhost:8000";
const DEFAULT_ASSETS_BASE_URL = "http://localhost:4444";
const ENV_API_BASE_URL = normalizeApiBaseUrl(
  typeof import.meta !== "undefined" ? import.meta.env?.VITE_API_BASE_URL : "",
);
const ENV_ASSETS_BASE_URL = normalizeAssetsBaseUrl(
  typeof import.meta !== "undefined"
    ? import.meta.env?.VITE_ASSETS_BASE_URL ?? import.meta.env?.VITE_BASE_URL
    : "",
);

let hasLoggedUrlConfig = false;

function logUrlConfigOnce(): void {
  if (hasLoggedUrlConfig || typeof window === "undefined") {
    return;
  }

  hasLoggedUrlConfig = true;
  console.info("[cards-ai] url config", {
    windowConfig: window.__APP_URL_CONFIG__ ?? null,
    envConfig: {
      apiBaseUrl: ENV_API_BASE_URL,
      assetsBaseUrl: ENV_ASSETS_BASE_URL,
    },
  });
}

declare global {
  interface Window {
    __APP_URL_CONFIG__?: {
      apiBaseUrl?: string;
      assetsBaseUrl?: string;
    };
  }
}

function normalizeApiBaseUrl(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return DEFAULT_API_BASE_URL;
  }

  return trimmed.replace(/\/+$/, "") || DEFAULT_API_BASE_URL;
}

function normalizeAssetsBaseUrl(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return DEFAULT_ASSETS_BASE_URL;
  }

  return trimmed.replace(/\/+$/, "") || DEFAULT_ASSETS_BASE_URL;
}

export function getApiBaseUrl(): string {
  if (typeof window === "undefined") {
    return ENV_API_BASE_URL;
  }

  logUrlConfigOnce();
  const windowOverride = window.__APP_URL_CONFIG__?.apiBaseUrl;
  if (windowOverride) {
    return normalizeApiBaseUrl(windowOverride);
  }

  return ENV_API_BASE_URL;
}

export function getAssetsBaseUrl(): string {
  if (typeof window === "undefined") {
    return ENV_ASSETS_BASE_URL;
  }

  logUrlConfigOnce();
  const windowOverride = window.__APP_URL_CONFIG__?.assetsBaseUrl;
  if (windowOverride) {
    return normalizeAssetsBaseUrl(windowOverride);
  }

  return ENV_ASSETS_BASE_URL;
}

export function buildApiUrl(path: string): string {
  const baseUrl = getApiBaseUrl();
  console.log("baseUrl", baseUrl);
  const normalizedPath = path.startsWith("/") ? path : `/${path}`;
  return `${baseUrl}${normalizedPath}`;
}
