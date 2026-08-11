import type { Knex } from "knex";
import { normalizeArtistName } from "../../utils/artistName.js";

export async function up(knex: Knex): Promise<void> {
  const artists = await knex("Artist").select("id", "name").orderBy("id");
  const artistsByName = new Map<string, typeof artists>();

  for (const artist of artists) {
    const key = normalizeArtistName(artist.name).toLowerCase();
    const group = artistsByName.get(key) ?? [];
    group.push(artist);
    artistsByName.set(key, group);
  }

  for (const group of artistsByName.values()) {
    const [keeper, ...duplicates] = group;
    for (const duplicate of duplicates) {
      await knex("BookArtist")
        .where("artist_id", duplicate.id)
        .update({ artist_id: keeper.id });
      await knex("Artist").where("id", duplicate.id).delete();
    }
    await knex("Artist")
      .where("id", keeper.id)
      .update({ name: normalizeArtistName(keeper.name) });
  }

  const links = await knex("BookArtist").select("id", "book_id", "artist_id");
  const seen = new Set<string>();
  for (const link of links) {
    const key = `${link.book_id}:${link.artist_id}`;
    if (seen.has(key)) await knex("BookArtist").where("id", link.id).delete();
    else seen.add(key);
  }
}

export async function down(): Promise<void> {
  // Irreversible data cleanup: merged duplicate artist rows cannot be restored.
}
