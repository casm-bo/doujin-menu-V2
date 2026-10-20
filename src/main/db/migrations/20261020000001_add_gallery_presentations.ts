import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.createTable("GalleryPresentation", (table) => {
    table.string("resource_key", 160).primary();
    table.text("payload").notNullable();
    table.bigInteger("version").notNullable();
    table.bigInteger("revision").notNullable().index();
  });
  await knex.schema.createTable("PresentationMutation", (table) => {
    table.string("device_id", 128).notNullable();
    table.string("mutation_id", 128).notNullable();
    table.string("request_hash", 64).notNullable();
    table.text("result").notNullable();
    table.primary(["device_id", "mutation_id"]);
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.dropTable("PresentationMutation");
  await knex.schema.dropTable("GalleryPresentation");
}
