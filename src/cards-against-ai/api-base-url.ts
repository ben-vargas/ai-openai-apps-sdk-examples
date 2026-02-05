const DEFAULT_ASSETS_BASE_URL = "http://localhost:4444";
const ENV_ASSETS_BASE_URL = normalizeAssetsBaseUrl(
  typeof import.meta !== "undefined"
    ? import.meta.env?.VITE_ASSETS_BASE_URL ?? import.meta.env?.VITE_BASE_URL
    : "",
);

declare global {
  interface Window {
    __APP_URL_CONFIG__?: {
      assetsBaseUrl?: string;
    };
  }
}

function normalizeAssetsBaseUrl(value: string | undefined): string {
  const trimmed = (value ?? "").trim();
  if (!trimmed) {
    return DEFAULT_ASSETS_BASE_URL;
  }

  return trimmed.replace(/\/+$/, "") || DEFAULT_ASSETS_BASE_URL;
}

export function getAssetsBaseUrl(): string {
  if (typeof window === "undefined") {
    return ENV_ASSETS_BASE_URL;
  }

  const windowOverride = window.__APP_URL_CONFIG__?.assetsBaseUrl;
  if (windowOverride) {
    return normalizeAssetsBaseUrl(windowOverride);
  }

  return ENV_ASSETS_BASE_URL;
}
