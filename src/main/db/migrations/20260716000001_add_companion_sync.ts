import type { Knex } from "knex";
import { randomUUID } from "crypto";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("Book", (table) => {
    table.string("sync_id");
    table.integer("state_version").notNullable().defaultTo(0);
    // SQLite rejects non-constant defaults such as CURRENT_TIMESTAMP when a
    // column is added to a table that already contains rows.
    table.timestamp("state_updated_at");
    table.string("updated_by_device_id");
  });

  const books = (await knex("Book").select("id")) as { id: number }[];
  const migratedAt = new Date().toISOString();
  for (const book of books) {
    await knex("Book").where("id", book.id).update({
      sync_id: randomUUID(),
      state_updated_at: migratedAt,
    });
  }
  await knex.schema.alterTable("Book", (table) => {
    table.unique(["sync_id"], { indexName: "uq_book_sync_id" });
    table.index(["state_updated_at"], "idx_book_state_updated_at");
  });

  // SQLite cannot use randomblob() as a column default. A trigger gives every
  // book created by existing scanner code a stable sync identifier.
  await knex.raw(`
    CREATE TRIGGER book_assign_sync_id
    AFTER INSERT ON Book
    WHEN NEW.sync_id IS NULL
    BEGIN
      UPDATE Book
      SET
        sync_id = lower(
          hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
          substr(hex(randomblob(2)), 2) || '-' ||
          substr('89ab', abs(random()) % 4 + 1, 1) ||
          substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
        ),
        state_updated_at = coalesce(NEW.state_updated_at, CURRENT_TIMESTAMP)
      WHERE id = NEW.id;
    END
  `);

  await knex.schema.alterTable("BookHistory", (table) => {
    table.string("event_id");
    table.string("device_id");
    table.integer("current_page");
  });
  const historyRows = (await knex("BookHistory").select("id")) as {
    id: number;
  }[];
  for (const row of historyRows) {
    await knex("BookHistory")
      .where("id", row.id)
      .update({ event_id: randomUUID(), device_id: "desktop" });
  }
  await knex.schema.alterTable("BookHistory", (table) => {
    table.unique(["event_id"], { indexName: "uq_book_history_event_id" });
  });
  await knex.raw(`
    CREATE TRIGGER book_history_assign_event_id
    AFTER INSERT ON BookHistory
    WHEN NEW.event_id IS NULL
    BEGIN
      UPDATE BookHistory
      SET event_id = lower(
        hex(randomblob(4)) || '-' || hex(randomblob(2)) || '-4' ||
        substr(hex(randomblob(2)), 2) || '-' ||
        substr('89ab', abs(random()) % 4 + 1, 1) ||
        substr(hex(randomblob(2)), 2) || '-' || hex(randomblob(6))
      ), device_id = coalesce(NEW.device_id, 'desktop')
      WHERE id = NEW.id;
    END
  `);

  await knex.schema.createTable("CompanionSyncChange", (table) => {
    table.increments("cursor").primary();
    table
      .integer("book_id")
      .unsigned()
      .notNullable()
      .references("id")
      .inTable("Book")
      .onDelete("CASCADE");
    table.string("book_sync_id").notNullable();
    table.integer("state_version").notNullable();
    table.integer("current_page");
    table.boolean("is_favorite").notNullable().defaultTo(false);
    table.timestamp("last_read_at");
    table.timestamp("changed_at").notNullable().defaultTo(knex.fn.now());
    table.string("device_id").notNullable();
    table.string("mutation_id").notNullable().unique();
    table.text("changed_fields").notNullable();
    table.string("history_event_id");
    table.timestamp("history_viewed_at");
    table.integer("history_current_page");
    table.index(["book_sync_id"], "idx_sync_change_book_sync_id");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTableIfExists("CompanionSyncChange");
  await knex.raw("DROP TRIGGER IF EXISTS book_history_assign_event_id");
  await knex.schema.alterTable("BookHistory", (table) => {
    table.dropUnique(["event_id"], "uq_book_history_event_id");
    table.dropColumn("event_id");
    table.dropColumn("device_id");
    table.dropColumn("current_page");
  });
  await knex.raw("DROP TRIGGER IF EXISTS book_assign_sync_id");
  await knex.schema.alterTable("Book", (table) => {
    table.dropIndex(["state_updated_at"], "idx_book_state_updated_at");
    table.dropUnique(["sync_id"], "uq_book_sync_id");
    table.dropColumn("sync_id");
    table.dropColumn("state_version");
    table.dropColumn("state_updated_at");
    table.dropColumn("updated_by_device_id");
  });
}
