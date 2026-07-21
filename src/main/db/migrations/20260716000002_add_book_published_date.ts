import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn("Book", "published_date")) return;
  await knex.schema.alterTable("Book", (table) => {
    table.dateTime("published_date").nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn("Book", "published_date"))) return;
  await knex.schema.alterTable("Book", (table) => {
    table.dropColumn("published_date");
  });
}
