import { createClient } from "@supabase/supabase-js";

function readViteEnv() {
  try {
    return import.meta.env || {};
  } catch {
    return {};
  }
}

export function createSupabaseService(envOverride = null) {
  const env = envOverride || readViteEnv();
  const url = typeof env.VITE_SUPABASE_URL === "string" ? env.VITE_SUPABASE_URL.trim() : "";
  const publishableKey =
    typeof env.VITE_SUPABASE_PUBLISHABLE_KEY === "string"
      ? env.VITE_SUPABASE_PUBLISHABLE_KEY.trim()
      : "";

  const isConfigured = Boolean(url && publishableKey);
  if (!isConfigured) {
    return {
      client: null,
      isConfigured: false,
      mode: "local",
      statusLabel: "Mode Lokal (tanpa Supabase)",
      note: "Kredensial Supabase publik belum diatur. Aplikasi memakai dataset terverifikasi di /public/data/."
    };
  }

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
}
