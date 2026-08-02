import knex, { type Knex } from "knex";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  down,
  up,
} from "../../../src/main/db/migrations/20260730000001_cleanup_empty_series_collections.js";

describe("empty series cleanup migration", () => {
  let db: Knex;

  beforeEach(async () => {
    db = knex({
      client: "better-sqlite3",
      connection: { filename: ":memory:" },
      useNullAsDefault: true,
    });
    await db.schema.createTable("SeriesCollection", (table) => {
      table.increments("id").primary();
      table.string("name").notNullable();
    });
    await db.schema.createTable("Book", (table) => {
      table.increments("id").primary();
      table.integer("series_collection_id").nullable();
    });
  });

  afterEach(async () => {
    await db.destroy();
  });

  it("removes existing empty series", async () => {
    await db("SeriesCollection").insert({ name: "Empty" });

    await up(db);

    expect(await db("SeriesCollection")).toEqual([]);
  });

  it("removes a series when its last book is deleted or moved", async () => {
    const [deletedSeriesId] = await db("SeriesCollection").insert({
      name: "Deleted",
    });
    const [movedSeriesId] = await db("SeriesCollection").insert({
      name: "Moved",
    });
    const [destinationSeriesId] = await db("SeriesCollection").insert({
      name: "Destination",
    });
    const [deletedBookId] = await db("Book").insert({
      series_collection_id: deletedSeriesId,
    });
    const [movedBookId] = await db("Book").insert({
      series_collection_id: movedSeriesId,
    });
    await db("Book").insert({ series_collection_id: destinationSeriesId });

    await up(db);
    await db("Book").where("id", deletedBookId).delete();
    await db("Book").where("id", movedBookId).update({
      series_collection_id: destinationSeriesId,
    });

    expect(await db("SeriesCollection").orderBy("id").pluck("name")).toEqual([
      "Destination",
    ]);
  });

  it("stops cleanup after rollback", async () => {
    const [seriesId] = await db("SeriesCollection").insert({ name: "Series" });
    const [bookId] = await db("Book").insert({
      series_collection_id: seriesId,
    });
    await up(db);
    await down(db);

    await db("Book").where("id", bookId).delete();

    expect(
      await db("SeriesCollection").where("id", seriesId).first(),
    ).toBeTruthy();
  });
});
