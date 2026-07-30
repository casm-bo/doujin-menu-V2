import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex("SeriesCollection")
    .whereNotExists(
      knex("Book")
        .select(1)
        .whereRaw("Book.series_collection_id = SeriesCollection.id"),
    )
    .delete();

  await knex.raw(`
    CREATE TRIGGER cleanup_empty_series_after_book_delete
    AFTER DELETE ON Book
    WHEN OLD.series_collection_id IS NOT NULL
    BEGIN
      DELETE FROM SeriesCollection
      WHERE id = OLD.series_collection_id
        AND NOT EXISTS (
          SELECT 1 FROM Book
          WHERE series_collection_id = OLD.series_collection_id
        );
    END
  `);

  await knex.raw(`
    CREATE TRIGGER cleanup_empty_series_after_book_move
    AFTER UPDATE OF series_collection_id ON Book
    WHEN OLD.series_collection_id IS NOT NULL
      AND OLD.series_collection_id IS NOT NEW.series_collection_id
    BEGIN
      DELETE FROM SeriesCollection
      WHERE id = OLD.series_collection_id
        AND NOT EXISTS (
          SELECT 1 FROM Book
          WHERE series_collection_id = OLD.series_collection_id
        );
    END
  `);
}

export async function down(knex: Knex): Promise<void> {
  await knex.raw("DROP TRIGGER IF EXISTS cleanup_empty_series_after_book_move");
  await knex.raw(
    "DROP TRIGGER IF EXISTS cleanup_empty_series_after_book_delete",
  );
}
