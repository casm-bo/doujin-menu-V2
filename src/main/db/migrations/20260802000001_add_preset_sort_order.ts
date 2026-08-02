import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("presets", (table) => {
    table.integer("sort_order");
  });
  await knex.raw("UPDATE presets SET sort_order = id");
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("presets", (table) => {
    table.dropColumn("sort_order");
  });
}
