const DEFAULT_ASSETS_BASE_URL = "http://localhost:4444";
const DEFAULT_API_BASE_URL = "http://localhost:8000";

const ENV_ASSETS_BASE_URL = normalizeBaseUrl(
  typeof import.meta !== "undefined"
    ? import.meta.env?.VITE_ASSETS_BASE_URL ?? import.meta.env?.VITE_BASE_URL
    : "",
  DEFAULT_ASSETS_BASE_URL,
);

const ENV_API_BASE_URL = normalizeBaseUrl(
  typeof import.meta !== "undefined"
    ? import.meta.env?.VITE_API_BASE_URL
    : "",
  DEFAULT_API_BASE_URL,
);

declare global {
  interface Window {
    __APP_URL_CONFIG__?: {
      assetsBaseUrl?: string;
      apiBaseUrl?: string;
    };
  }
}

function normalizeBaseUrl(
  value: string | undefined,
  fallback: string,
): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return fallback;
  }

  return trimmed.replace(/\/+$/, "") || fallback;
}

export function getAssetsBaseUrl(): string {
  if (typeof window === "undefined") {
    return ENV_ASSETS_BASE_URL;
  }

  const windowOverride = window.__APP_URL_CONFIG__?.assetsBaseUrl;
  if (windowOverride) {
    return normalizeBaseUrl(windowOverride, DEFAULT_ASSETS_BASE_URL);
  }

  return ENV_ASSETS_BASE_URL;
}

export function getApiBaseUrl(): string {
  if (typeof window === "undefined") {
    return ENV_API_BASE_URL;
  }

  const windowOverride = window.__APP_URL_CONFIG__?.apiBaseUrl;
  if (windowOverride) {
    return normalizeBaseUrl(windowOverride, DEFAULT_API_BASE_URL);
  }

  return ENV_API_BASE_URL;
}
