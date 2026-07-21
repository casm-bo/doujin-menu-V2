import knex, { type Knex } from "knex";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  down,
  up,
} from "../../../src/main/db/migrations/20260716000002_add_book_published_date.js";

describe("published date migration", () => {
  let db: Knex;

  beforeEach(async () => {
    db = knex({
      client: "better-sqlite3",
      connection: { filename: ":memory:" },
      useNullAsDefault: true,
    });
    await db.schema.createTable("Book", (table) => {
      table.increments("id").primary();
    });
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("adds and removes the published date column", async () => {
    await up(db);
    expect(await db.schema.hasColumn("Book", "published_date")).toBe(true);

    await down(db);
    expect(await db.schema.hasColumn("Book", "published_date")).toBe(false);
  });

  it("is safe when the column already exists", async () => {
    await db.schema.alterTable("Book", (table) => {
      table.dateTime("published_date").nullable();
    });

    await expect(up(db)).resolves.toBeUndefined();
    expect(await db.schema.hasColumn("Book", "published_date")).toBe(true);
  });
});
