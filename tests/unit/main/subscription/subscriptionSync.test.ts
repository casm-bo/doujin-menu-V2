import type { Knex } from "knex";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createTestDb,
  truncateAll,
} from "../../../../src/main/db/test-utils.js";
import {
  SubscriptionSyncService,
  isSyncedSubscription,
  type SyncedSubscription,
} from "../../../../src/main/services/subscription/subscriptionSync.js";
import { CompanionServer } from "../../../../src/main/services/companion/companionServer.js";
import type { CompanionDevice } from "../../../../src/types/companion.js";

describe("subscription synchronization", () => {
  let db: Knex;
  let service: SubscriptionSyncService;
  const value: SyncedSubscription = {
    id: "example-subscription",
    name: "Example",
    query: "artist:example",
    languages: [],
    enabled: true,
    deleted: false,
    version: 0,
  };
  beforeAll(async () => {
    db = await createTestDb();
    service = new SubscriptionSyncService(db);
  });
  beforeEach(async () => {
    await truncateAll(db);
  });
  afterAll(async () => {
    await db.destroy();
  });
  it("migrates ordinary desktop edits into a durable feed and preserves deletion tombstones", async () => {
    const [id] = await db("Subscription").insert({
      query: value.query,
      normalized_query: value.query,
      label: value.name,
    });
    const first = await service.changes(0);
    expect(first.changes[0].value).toMatchObject({
      name: "Example",
      version: 1,
      deleted: false,
    });
    await db("Subscription").where({ id }).update({ label: "Desktop edit" });
    await db("Subscription")
      .where({ id })
      .update({ deleted: true, enabled: false });
    const next = await service.changes(first.cursor);
    expect(next.changes.map((c) => c.value.version)).toEqual([2, 3]);
    expect(next.changes.at(-1)!.value.deleted).toBe(true);
  });
  it("retries lost acknowledgements and rejects a reused mutation ID", async () => {
    const first = await service.save("test-device", "mutation-a", value);
    expect(first.status).toBe("applied");
    const reordered = Object.fromEntries(
      Object.entries(value).reverse(),
    ) as unknown as SyncedSubscription;
    expect(await service.save("test-device", "mutation-a", reordered)).toEqual(
      first,
    );
    expect(await service.save("test-device", "mutation-a", value)).toEqual(
      first,
    );
    await expect(
      service.save("test-device", "mutation-a", {
        ...value,
        name: "Different",
      }),
    ).rejects.toThrow("reused");
    expect((await db("Subscription")).length).toBe(1);
  });
  it("preserves concurrent edits and detects duplicate conditions", async () => {
    const first = await service.save("test-device", "mutation-a", value);
    await db("Subscription")
      .where("sync_id", value.id)
      .update({ label: "PC edit" });
    const result = await service.save("test-device", "mutation-b", {
      ...first.value,
      name: "Phone edit",
    });
    expect(result).toMatchObject({
      status: "conflict",
      value: { name: "PC edit", version: 2 },
    });
    const duplicate = await service.save("test-device", "mutation-c", {
      ...value,
      id: "other-example",
    });
    expect(duplicate).toMatchObject({
      status: "conflict",
      value: { id: value.id },
    });
  });
  it("shares read state without repeating events and pages every change", async () => {
    for (let i = 1; i <= 205; i++) await service.read([i]);
    await service.read([1, 2]);
    const first = await service.changes(0),
      second = await service.changes(first.cursor);
    expect(first.changes.length).toBe(200);
    expect(first.hasMore).toBe(true);
    expect(second.changes.length).toBe(5);
    expect(second.hasMore).toBe(false);
    expect(second.changes.at(-1)).toEqual({
      kind: "read",
      value: { galleryId: 205 },
    });
  });
  it("accepts keyword shortcuts only with monitoring off", () => {
    expect(
      isSyncedSubscription({ ...value, query: "title words", enabled: false }),
    ).toBe(true);
    for (const query of [
      "title words",
      "artist:example words",
      "-tag:example",
      "bad:example",
    ])
      expect(isSyncedSubscription({ ...value, query })).toBe(false);
  });
  it("authenticates the subscription API and validates mutation and read requests", async () => {
    let devices: CompanionDevice[] = [];
    const server = new CompanionServer(
      {
        searchGalleries: async () => ({ data: [], hasNextPage: false }),
        getGalleryDetails: async () => ({}),
        getGalleryImageUrls: async () => [],
      },
      {
        getDevices: () => devices,
        setDevices: (next) => {
          devices = next;
        },
      },
      undefined,
      undefined,
      undefined,
      service,
    );
    const status = await server.start(0),
      url = `http://127.0.0.1:${status.port}`;
    try {
      expect((await fetch(`${url}/v1/subscriptions`)).status).toBe(401);
      const code = server.createPairingCode();
      const pair = await fetch(`${url}/v1/pair`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          code: code.code,
          deviceName: "Synthetic Phone",
        }),
      });
      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${(await pair.json()).data.token}`,
      };
      expect(
        (
          await fetch(`${url}/v1/subscriptions`, {
            method: "POST",
            headers,
            body: JSON.stringify({ mutationId: "test-mutation", value }),
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await fetch(`${url}/v1/subscriptions/read`, {
            method: "POST",
            headers,
            body: JSON.stringify({ ids: [12] }),
          })
        ).status,
      ).toBe(200);
      expect(
        (
          await fetch(`${url}/v1/subscriptions/read`, {
            method: "POST",
            headers,
            body: JSON.stringify({ ids: [-1] }),
          })
        ).status,
      ).toBe(400);
      const page = await fetch(`${url}/v1/subscriptions?cursor=0`, { headers });
      expect((await page.json()).data.changes).toHaveLength(2);
      expect(
        (await fetch(`${url}/v1/subscriptions?cursor=-1`, { headers })).status,
      ).toBe(400);
    } finally {
      await server.stop();
    }
  });
});
