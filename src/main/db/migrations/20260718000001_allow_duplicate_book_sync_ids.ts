import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("Book", (table) => {
    table.dropUnique(["sync_id"], "uq_book_sync_id");
    table.index(["sync_id"], "idx_book_sync_id");
  });
}

export async function down(knex: Knex): Promise<void> {
  const duplicates = (await knex("Book")
    .select("sync_id")
    .whereNotNull("sync_id")
    .groupBy("sync_id")
    .havingRaw("count(*) > 1")) as { sync_id: string }[];
  for (const duplicate of duplicates) {
    const copies = await knex("Book")
      .select("id")
      .where("sync_id", duplicate.sync_id)
      .orderBy("id", "asc");
    for (const copy of copies.slice(1)) {
      await knex("Book").where("id", copy.id).update({ sync_id: null });
    }
  }
  await knex.schema.alterTable("Book", (table) => {
    table.dropIndex(["sync_id"], "idx_book_sync_id");
    table.unique(["sync_id"], { indexName: "uq_book_sync_id" });
  });
}
