import knex, { type Knex } from "knex";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { up } from "../../../src/main/db/migrations/20260811000001_normalize_artist_names.js";

describe("artist name normalization migration", () => {
  let db: Knex;

  beforeEach(async () => {
    db = knex({
      client: "better-sqlite3",
      connection: { filename: ":memory:" },
      useNullAsDefault: true,
    });
    await db.schema.createTable("Artist", (table) => {
      table.increments("id").primary();
      table.string("name").notNullable().unique();
    });
    await db.schema.createTable("BookArtist", (table) => {
      table.increments("id").primary();
      table.integer("book_id").notNullable();
      table.integer("artist_id").notNullable();
    });
  });

  afterEach(async () => db.destroy());

  it("merges space and underscore variants without duplicate links", async () => {
    const [spaceId] = await db("Artist").insert({ name: "AB CD" });
    const [underscoreId] = await db("Artist").insert({ name: "AB_CD" });
    await db("BookArtist").insert([
      { book_id: 1, artist_id: spaceId },
      { book_id: 1, artist_id: underscoreId },
      { book_id: 2, artist_id: underscoreId },
    ]);

    await up(db);

    expect(await db("Artist").select("id", "name")).toEqual([
      { id: spaceId, name: "AB_CD" },
    ]);
    expect(
      await db("BookArtist").select("book_id", "artist_id").orderBy("book_id"),
    ).toEqual([
      { book_id: 1, artist_id: spaceId },
      { book_id: 2, artist_id: spaceId },
    ]);
  });
});
