import { describe, expect, it } from "vitest";
import { parseMediaRequestUrl } from "../../../src/main/mediaProtocol";

describe("parseMediaRequestUrl", () => {
  it("parses fixed-host page URLs without numeric-host normalization", () => {
    expect(parseMediaRequestUrl("doujin-menu://page/420/0")).toEqual({
      kind: "page",
      bookId: 420,
      pageIndex: 0,
    });
  });

  it("accepts only a single safe thumbnail filename", () => {
    expect(
      parseMediaRequestUrl("doujin-menu://thumbnail/420.webp?v=1"),
    ).toEqual({
      kind: "thumbnail",
      fileName: "420.webp",
    });
    expect(
      parseMediaRequestUrl("doujin-menu://thumbnail/..%2Fsecret"),
    ).toBeNull();
    expect(parseMediaRequestUrl("doujin-menu://420/0")).toBeNull();
  });
});
