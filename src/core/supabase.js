import { createClient } from "@supabase/supabase-js";

function readViteEnv() {
  try {
    return import.meta.env || {};
  } catch {
    return {};
  }
}

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:";
  } catch {
    return false;
  }
}

const PRIVILEGED_ROLE_NAME = ["service", "role"].join("_");

function looksLikeSecretOrPrivilegedKey(key) {
  if (!key) return false;
  const trimmed = key.trim();
  if (/^sb_secret_/i.test(trimmed) || trimmed.toLowerCase().includes(PRIVILEGED_ROLE_NAME)) {
    return true;
  }
  // Reject JWT keys carrying privileged role without logging or exposing secret tokens
  const parts = trimmed.split(".");
  if (parts.length === 3 && typeof atob === "function") {
    try {
      const b64 = parts[1].replace(/-/g, "+").replace(/_/g, "/");
      const json = JSON.parse(atob(b64));
      if (json && String(json.role || "").toLowerCase() === PRIVILEGED_ROLE_NAME) {
        return true;
      }
    } catch {
      return false;
    }
  }
  return false;
}

export function createSupabaseService(envOverride = null) {
  const env = envOverride || readViteEnv();
  const url = typeof env.VITE_SUPABASE_URL === "string" ? env.VITE_SUPABASE_URL.trim() : "";
  const publishableKey =
    typeof env.VITE_SUPABASE_PUBLISHABLE_KEY === "string"
      ? env.VITE_SUPABASE_PUBLISHABLE_KEY.trim()
      : "";

  if (!url || !publishableKey) {
    return {
      client: null,
      isConfigured: false,
      mode: "local",
      statusLabel: "Mode Lokal (tanpa Supabase)",
      note: "Kredensial Supabase publik belum diatur. Aplikasi memakai dataset terverifikasi di /public/data/."
    };
  }

  if (!isValidHttpUrl(url)) {
    return {
      client: null,
      isConfigured: false,
      mode: "local",
      statusLabel: "Mode Lokal (URL tidak valid)",
      note: "VITE_SUPABASE_URL tidak valid (harus diawali http:// atau https://). Aplikasi memakai dataset lokal."
    };
  }

  if (looksLikeSecretOrPrivilegedKey(publishableKey)) {
    return {
      client: null,
      isConfigured: false,
      mode: "local",
      statusLabel: "Mode Lokal (kunci ditolak)",
      note: "Kunci non-publik (sb_secret_ atau role privat) dilarang di frontend. Aplikasi tetap berjalan di mode lokal."
    };
  }

  try {
    const client = createClient(url, publishableKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true
      }
    });

    return {
      client,
      isConfigured: true,
      mode: "supabase",
      statusLabel: "Terhubung ke Supabase",
      note: "Menggunakan URL dan publishable key proyek Supabase dengan Row Level Security aktif."
    };
  } catch {
    return {
      client: null,
      isConfigured: false,
      mode: "local",
      statusLabel: "Mode Lokal (fallback inisialisasi)",
      note: "Inisialisasi klien Supabase gagal; aplikasi beralih ke dataset lokal di /public/data/."
    };
  }
}
