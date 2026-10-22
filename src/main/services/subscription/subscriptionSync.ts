import type { Knex } from "knex";
import { normalizeQuery } from "./query.js";

export interface SyncedSubscription {
  id: string;
  name: string;
  query: string;
  languages: string[];
  enabled: boolean;
  deleted: boolean;
  version: number;
}
const tag =
  /^-?(artist|group|series|character|type|tag|male|female|language):[a-z0-9_.-]+$/;
export function subscriptionKey(
  query: string,
  languages: string[] = [],
): string {
  const base = query
    .split(/\s+/)
    .filter((t) => !t.startsWith("language:"))
    .join(" ");
  return languages.length
    ? [...new Set(languages)]
        .sort()
        .map((l) => normalizeQuery(`${base} language:${l}`))
        .join("\n")
    : normalizeQuery(query);
}
export function isSyncedSubscription(
  value: unknown,
): value is SyncedSubscription {
  if (!value || typeof value !== "object") return false;
  const v = value as SyncedSubscription;
  if (
    typeof v.id !== "string" ||
    !/^[a-zA-Z0-9-]{1,80}$/.test(v.id) ||
    typeof v.name !== "string" ||
    !v.name.trim() ||
    v.name.length > 200 ||
    typeof v.query !== "string" ||
    !v.query.trim() ||
    v.query.length > 2000 ||
    !Array.isArray(v.languages) ||
    v.languages.length > 20 ||
    v.languages.some(
      (l) => typeof l !== "string" || !/^[a-z0-9_-]{1,50}$/.test(l),
    ) ||
    typeof v.enabled !== "boolean" ||
    typeof v.deleted !== "boolean" ||
    !Number.isSafeInteger(v.version) ||
    v.version < 0
  )
    return false;
  const terms = v.query.trim().split(/\s+/);
  return (
    !v.enabled ||
    v.deleted ||
    (terms.every((t) => tag.test(t)) && terms.some((t) => !t.startsWith("-")))
  );
}
const toValue = (row: Record<string, unknown>): SyncedSubscription => ({
  id: String(row.sync_id),
  name: String(row.label ?? row.query),
  query: String(row.query),
  languages: JSON.parse(String(row.languages)),
  enabled: Boolean(row.enabled),
  deleted: Boolean(row.deleted),
  version: Number(row.sync_version),
});
export class SubscriptionSyncService {
  constructor(private readonly db: Knex) {}
  async changes(cursor: number) {
    const rows = await this.db("SubscriptionSyncChange")
      .where("seq", ">", cursor)
      .orderBy("seq")
      .limit(201);
    const page = rows.slice(0, 200);
    return {
      changes: page.map((r) => ({
        kind: r.kind,
        value: JSON.parse(r.payload),
      })),
      cursor: Number(page.at(-1)?.seq ?? cursor),
      hasMore: rows.length > 200,
    };
  }
  async save(deviceId: string, mutationId: string, value: SyncedSubscription) {
    const request = JSON.stringify({
      id: value.id,
      name: value.name,
      query: value.query,
      languages: [...new Set(value.languages)].sort(),
      enabled: value.enabled,
      deleted: value.deleted,
      version: value.version,
    });
    return this.db.transaction(async (tx) => {
      const receipt = await tx("SubscriptionMutation")
        .where({ device_id: deviceId, mutation_id: mutationId })
        .first();
      if (receipt) {
        if (receipt.request !== request)
          throw new Error("Mutation ID was reused with a different value");
        return JSON.parse(receipt.response) as {
          status: string;
          value: SyncedSubscription;
        };
      }
      const current = await tx("Subscription")
        .where("sync_id", value.id)
        .first();
      let result: { status: string; value: SyncedSubscription };
      const normalized = subscriptionKey(value.query, value.languages);
      const duplicate = await tx("Subscription")
        .where("normalized_query", normalized)
        .whereNot("sync_id", value.id)
        .first();
      if (duplicate) result = { status: "conflict", value: toValue(duplicate) };
      else if ((current?.sync_version ?? 0) !== value.version) {
        if (!current) throw new Error("Unknown subscription version");
        result = { status: "conflict", value: toValue(current) };
      } else {
        const fields = {
          query: value.query.trim(),
          normalized_query: normalized,
          label: value.name.trim(),
          enabled: value.enabled,
          deleted: value.deleted,
          languages: JSON.stringify([...new Set(value.languages)].sort()),
        };
        if (current)
          await tx("Subscription").where("id", current.id).update(fields);
        else await tx("Subscription").insert({ ...fields, sync_id: value.id });
        result = {
          status: "applied",
          value: toValue(
            await tx("Subscription").where("sync_id", value.id).first(),
          ),
        };
      }
      await tx("SubscriptionMutation").insert({
        device_id: deviceId,
        mutation_id: mutationId,
        request,
        response: JSON.stringify(result),
      });
      return result;
    });
  }
  async read(ids: number[]) {
    await this.db.transaction(async (tx) => {
      for (const id of ids)
        await tx("SubscriptionRead")
          .insert({ gallery_id: id })
          .onConflict("gallery_id")
          .ignore();
    });
  }
}
