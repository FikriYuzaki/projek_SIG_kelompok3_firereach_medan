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
