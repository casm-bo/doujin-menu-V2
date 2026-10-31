import { afterEach, expect, it, vi } from "vitest";

afterEach(() => vi.unstubAllEnvs());

it.each([
  ["debug", "동인집 DEBUG"],
  ["production", "동인집"],
  ["development", "동인집"],
])("labels %s builds correctly", async (mode, title) => {
  vi.resetModules();
  vi.stubEnv("MODE", mode);
  expect((await import("../../../src/renderer/lib/appTitle")).APP_TITLE).toBe(
    title,
  );
});
