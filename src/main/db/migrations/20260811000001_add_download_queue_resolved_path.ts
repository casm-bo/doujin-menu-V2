import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  if (await knex.schema.hasColumn("DownloadQueue", "resolved_path")) return;
  await knex.schema.alterTable("DownloadQueue", (table) => {
    table.text("resolved_path").nullable();
  });
}

export async function down(knex: Knex): Promise<void> {
  if (!(await knex.schema.hasColumn("DownloadQueue", "resolved_path"))) return;
  await knex.schema.alterTable("DownloadQueue", (table) => {
    table.dropColumn("resolved_path");
  });
}
