import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  list: vi.fn(),
}));

vi.mock("node-hitomi", () => ({
  hitomi: {
    tags: { create: mocks.create },
    galleries: { list: mocks.list },
  },
}));

const { fetchTagIds } =
  await import("../../../../src/main/services/subscription/nozomi.js");

describe("fetchTagIds", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.create.mockReturnValue({ type: "artist", name: "foo" });
    mocks.list.mockResolvedValue([{ id: 30 }, { id: 20 }, { id: 10 }]);
  });

  it("uses the supported node-hitomi gallery API", async () => {
    const tag = { type: "artist", name: "foo" } as never;

    await expect(fetchTagIds(tag)).resolves.toEqual([30, 20, 10]);
    expect(mocks.create).toHaveBeenCalledWith("artist", "foo");
    expect(mocks.list).toHaveBeenCalledWith({
      tags: [{ type: "artist", name: "foo" }],
    });
  });
});
