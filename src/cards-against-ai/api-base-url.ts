const DEFAULT_BASE_URL = "http://localhost:8000";

const ENV_BASE_URL = normalizeBaseUrl(
  typeof import.meta !== "undefined"
    ? import.meta.env?.VITE_BASE_URL
    : "",
  DEFAULT_BASE_URL,
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

function getBaseUrl(): string {
  if (typeof window === "undefined") {
    return ENV_BASE_URL;
  }

  // Check both config keys for backward compat
  const windowOverride =
    window.__APP_URL_CONFIG__?.apiBaseUrl ??
    window.__APP_URL_CONFIG__?.assetsBaseUrl;
  if (windowOverride) {
    return normalizeBaseUrl(windowOverride, DEFAULT_BASE_URL);
  }

  return ENV_BASE_URL;
}

export function getAssetsBaseUrl(): string {
  return getBaseUrl();
}

export function getApiBaseUrl(): string {
  return getBaseUrl();
}
