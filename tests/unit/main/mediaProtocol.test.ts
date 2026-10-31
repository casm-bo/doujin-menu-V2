import { describe, expect, it } from "vitest";
import { parseMediaRequestUrl } from "../../../src/main/mediaProtocol";

describe("parseMediaRequestUrl", () => {
  it("keeps stored legacy media URLs readable without accepting other schemes", () => {
    expect(parseMediaRequestUrl("doujin-menu://page/420/0")).toEqual({
      kind: "page",
      bookId: 420,
      pageIndex: 0,
    });
    expect(parseMediaRequestUrl("https://page/420/0")).toBeNull();
    expect(
      parseMediaRequestUrl("doujin-menu://thumbnail/..%2Fsecret"),
    ).toBeNull();
  });
  it("parses fixed-host page URLs without numeric-host normalization", () => {
    expect(parseMediaRequestUrl("doujinzip://page/420/0")).toEqual({
      kind: "page",
      bookId: 420,
      pageIndex: 0,
    });
  });

  it("accepts only a single safe thumbnail filename", () => {
    expect(parseMediaRequestUrl("doujinzip://thumbnail/420.webp?v=1")).toEqual({
      kind: "thumbnail",
      fileName: "420.webp",
    });
    expect(
      parseMediaRequestUrl("doujinzip://thumbnail/..%2Fsecret"),
    ).toBeNull();
    expect(parseMediaRequestUrl("doujinzip://420/0")).toBeNull();
  });

  it("parses downloader cache URLs without allowing nested paths", () => {
    expect(
      parseMediaRequestUrl(
        "doujinzip://download-thumbnail/123_cover%20image.webp",
      ),
    ).toEqual({
      kind: "download-thumbnail",
      fileName: "123_cover image.webp",
    });
    expect(
      parseMediaRequestUrl("doujinzip://download-thumbnail/..%2Fsecret"),
    ).toBeNull();
  });
});
