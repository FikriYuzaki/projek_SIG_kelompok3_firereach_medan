import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createSupabaseService } from "../../src/core/supabase.js";

describe("supabase local-only safety & credential hygiene", () => {
  it("falls back safely to local-only mode when credentials are empty", () => {
    const svc = createSupabaseService({ VITE_SUPABASE_URL: "", VITE_SUPABASE_PUBLISHABLE_KEY: "" });
    expect(svc.isConfigured).toBe(false);
    expect(svc.client).toBeNull();
    expect(svc.mode).toBe("local");
    expect(svc.statusLabel).toContain("Mode Lokal");
  });

  it("rejects malformed Supabase URLs and secret/service_role keys safely", () => {
    const badUrl = createSupabaseService({
      VITE_SUPABASE_URL: "not-a-valid-url",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_demo"
    });
    expect(badUrl.isConfigured).toBe(false);
    expect(badUrl.client).toBeNull();

    const secretKey = createSupabaseService({
      VITE_SUPABASE_URL: "https://example.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_secret_forbidden_token"
    });
    expect(secretKey.isConfigured).toBe(false);
    expect(secretKey.client).toBeNull();
    expect(secretKey.note).toContain("dilarang");
  });

  it("never exposes service_role or secret keys in frontend source files", () => {
    const srcRoot = path.resolve(process.cwd(), "src");
    const stack = [srcRoot];
    while (stack.length) {
      const dir = stack.pop();
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          stack.push(full);
        } else if (entry.name.endsWith(".js")) {
          const text = fs.readFileSync(full, "utf-8");
          expect(text).not.toMatch(/service_role/i);
        }
      }
    }
  });
});
