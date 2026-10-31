import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("Book", (table) => {
    table.boolean("missing_id_reviewed").notNullable().defaultTo(false);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("Book", (table) => {
    table.dropColumn("missing_id_reviewed");
  });
}
