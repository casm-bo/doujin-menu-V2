import { describe, expect, it } from "vitest";
import { useTagDisplay } from "../../../src/renderer/composable/useTagDisplay";

describe("useTagDisplay", () => {
  it.each([
    ["female:glasses", "glasses", "bg-pink-100"],
    ["male:muscle", "muscle", "bg-blue-100"],
  ])("색상으로 성별 접두사를 대신한다", (name, displayText, color) => {
    const result = useTagDisplay().getTagDisplayInfo({ name });

    expect(result.displayText).toBe(displayText);
    expect(result.className).toContain(color);
  });
});
