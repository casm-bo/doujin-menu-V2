import knex, { type Knex } from "knex";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { up } from "../../../src/main/db/migrations/20260716000001_add_companion_sync.js";

describe("companion sync migration", () => {
  let db: Knex;

  beforeEach(async () => {
    db = knex({
      client: "better-sqlite3",
      connection: { filename: ":memory:" },
      useNullAsDefault: true,
    });
    await db.schema.createTable("Book", (table) => {
      table.increments("id").primary();
      table.string("title").notNullable();
    });
    await db.schema.createTable("BookHistory", (table) => {
      table.increments("id").primary();
      table.integer("book_id").notNullable();
      table.timestamp("viewed_at").defaultTo(db.fn.now());
    });
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("migrates a database that already contains books and history", async () => {
    const [bookId] = await db("Book").insert({ title: "Existing book" });
    await db("BookHistory").insert({ book_id: bookId });

    await expect(up(db)).resolves.toBeUndefined();

    const book = await db("Book").where("id", bookId).first();
    const history = await db("BookHistory").where("book_id", bookId).first();
    expect(book.sync_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(book.state_updated_at).toBeTruthy();
    expect(history.event_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(history.device_id).toBe("desktop");
  });

  it("assigns sync metadata to books inserted after migration", async () => {
    await up(db);

    const [bookId] = await db("Book").insert({ title: "New book" });
    const book = await db("Book").where("id", bookId).first();

    expect(book.sync_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(book.state_updated_at).toBeTruthy();
  });
});
