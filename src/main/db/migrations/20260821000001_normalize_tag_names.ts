import type { Knex } from "knex";
import { normalizeTagName } from "../../utils/tagName.js";

export async function up(knex: Knex): Promise<void> {
  const tags = await knex("Tag").select("id", "name").orderBy("id");
  const tagsByName = new Map<string, typeof tags>();

  for (const tag of tags) {
    const key = normalizeTagName(tag.name).toLowerCase();
    const group = tagsByName.get(key) ?? [];
    group.push(tag);
    tagsByName.set(key, group);
  }

  for (const group of tagsByName.values()) {
    const [keeper, ...duplicates] = group;
    for (const duplicate of duplicates) {
      await knex("BookTag")
        .where("tag_id", duplicate.id)
        .update({ tag_id: keeper.id });
      await knex("Tag").where("id", duplicate.id).delete();
    }
    await knex("Tag")
      .where("id", keeper.id)
      .update({ name: normalizeTagName(keeper.name) });
  }

  const links = await knex("BookTag").select("id", "book_id", "tag_id");
  const seen = new Set<string>();
  for (const link of links) {
    const key = `${link.book_id}:${link.tag_id}`;
    if (seen.has(key)) await knex("BookTag").where("id", link.id).delete();
    else seen.add(key);
  }
}

export async function down(): Promise<void> {
  // Irreversible data cleanup: merged duplicate tag rows cannot be restored.
}
