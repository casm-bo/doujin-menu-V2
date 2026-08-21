import knex, { type Knex } from "knex";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { up } from "../../../src/main/db/migrations/20260821000001_normalize_tag_names.js";

describe("tag name normalization migration", () => {
  let db: Knex;

  beforeEach(async () => {
    db = knex({
      client: "better-sqlite3",
      connection: { filename: ":memory:" },
      useNullAsDefault: true,
    });
    await db.schema.createTable("Tag", (table) => {
      table.increments("id").primary();
      table.string("name").notNullable().unique();
    });
    await db.schema.createTable("BookTag", (table) => {
      table.increments("id").primary();
      table.integer("book_id").notNullable();
      table.integer("tag_id").notNullable();
    });
  });

  afterEach(async () => db.destroy());

  it("merges space and underscore variants without duplicate links", async () => {
    const [spaceId] = await db("Tag").insert({ name: "long hair" });
    const [underscoreId] = await db("Tag").insert({ name: "long_hair" });
    await db("BookTag").insert([
      { book_id: 1, tag_id: spaceId },
      { book_id: 1, tag_id: underscoreId },
      { book_id: 2, tag_id: underscoreId },
    ]);

    await up(db);

    expect(await db("Tag").select("id", "name")).toEqual([
      { id: spaceId, name: "long_hair" },
    ]);
    expect(
      await db("BookTag").select("book_id", "tag_id").orderBy("book_id"),
    ).toEqual([
      { book_id: 1, tag_id: spaceId },
      { book_id: 2, tag_id: spaceId },
    ]);
  });
});
