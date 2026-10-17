import { getChangelog } from "@/lib/changelog";
import { expect, it } from "vitest";
import packageJson from "../../../package.json";

it("lists the current app version first with update details", () => {
  const latest = getChangelog();
  expect(latest?.version).toBe(packageJson.version);
  expect(getChangelog(packageJson.version)).toBe(latest);
  expect(latest?.changes.length).toBeGreaterThan(0);
  for (const change of latest?.changes ?? []) {
    expect(change.title.trim()).not.toBe("");
    expect(change.items.length).toBeGreaterThan(0);
    for (const item of change.items) expect(item.trim()).not.toBe("");
  }
});
