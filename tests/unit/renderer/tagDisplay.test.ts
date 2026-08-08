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

  it.each([
    ["female", "glasses", "bg-pink-100"],
    ["male", "muscle", "bg-blue-100"],
  ])("다운로더 태그 타입을 색상으로 표시한다", (type, name, color) => {
    const result = useTagDisplay().getTagDisplayInfo({ name, type });

    expect(result.displayText).toBe(name);
    expect(result.className).toContain(color);
  });
});
