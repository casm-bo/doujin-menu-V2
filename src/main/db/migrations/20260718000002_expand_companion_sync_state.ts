import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("Book", (table) => {
    table.boolean("is_read").notNullable().defaultTo(false);
    table.boolean("is_hidden").notNullable().defaultTo(false);
    table.text("custom_title");
  });
  await knex("Book")
    .whereNotNull("last_read_at")
    .orWhere("current_page", ">", 0)
    .update({ is_read: true });
  await knex.schema.alterTable("SeriesCollection", (table) => {
    table.boolean("is_favorite").notNullable().defaultTo(false);
  });
  await knex.schema.alterTable("CompanionSyncChange", (table) => {
    table.text("state_payload").notNullable().defaultTo("{}");
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("CompanionSyncChange", (table) => {
    table.dropColumn("state_payload");
  });
  await knex.schema.alterTable("SeriesCollection", (table) => {
    table.dropColumn("is_favorite");
  });
  await knex.schema.alterTable("Book", (table) => {
    table.dropColumn("is_read");
    table.dropColumn("is_hidden");
    table.dropColumn("custom_title");
  });
}
