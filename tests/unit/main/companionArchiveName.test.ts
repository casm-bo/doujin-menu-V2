import { describe, expect, it, vi } from "vitest";

vi.mock("../../../src/main/db/index.js", () => ({ default: {} }));
vi.mock("../../../src/main/handlers/bookHandler.js", () => ({
  handleDeleteBook: vi.fn(),
}));

import { sanitizeArchiveName } from "../../../src/main/services/companion/companionLibraryService.js";

describe("sanitizeArchiveName", () => {
  it("removes a long trailing dot run without regex backtracking", () => {
    expect(sanitizeArchiveName(`book${".".repeat(10_000)}.cbz`)).toBe(
      "book.cbz",
    );
  });
});
