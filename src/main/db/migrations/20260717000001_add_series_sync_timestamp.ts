import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("Book", (table) => {
    table.bigInteger("series_state_updated_at");
  });

  const now = Date.now();
  await knex("Book").update({ series_state_updated_at: now });

  await knex.raw(`
    CREATE TRIGGER book_series_state_timestamp
    AFTER UPDATE OF series_collection_id, series_order_index ON Book
    WHEN NEW.series_state_updated_at IS OLD.series_state_updated_at
    BEGIN
      UPDATE Book
      SET series_state_updated_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
      WHERE id = NEW.id;
    END
  `);

  await knex.raw(`
    CREATE TRIGGER series_name_state_timestamp
    AFTER UPDATE OF name ON SeriesCollection
    WHEN NEW.name IS NOT OLD.name
    BEGIN
      UPDATE Book
      SET series_state_updated_at = CAST((julianday('now') - 2440587.5) * 86400000 AS INTEGER)
      WHERE series_collection_id = NEW.id;
    END
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw("DROP TRIGGER IF EXISTS series_name_state_timestamp");
  await knex.raw("DROP TRIGGER IF EXISTS book_series_state_timestamp");
  await knex.schema.alterTable("Book", (table) => {
    table.dropColumn("series_state_updated_at");
  });
}
