import path from "path";
import { mkdirSync } from "fs";
import { expect, it, vi } from "vitest";

const app = vi.hoisted(() => ({
  getPath: vi.fn(() => "/synthetic/app-data"),
  setPath: vi.fn(),
}));
vi.mock("electron", () => ({ app }));
vi.mock("fs", () => ({ mkdirSync: vi.fn() }));

it("isolates app data before application stores open", async () => {
  await import("../../../src/main/appIdentity");
  expect(app.getPath).toHaveBeenCalledWith("appData");
  expect(mkdirSync).toHaveBeenCalledWith(
    path.join("/synthetic/app-data", "doujinzip"),
    { recursive: true },
  );
  expect(app.setPath).toHaveBeenCalledWith(
    "userData",
    path.join("/synthetic/app-data", "doujinzip"),
  );
});
