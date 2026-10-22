import type { Knex } from "knex";

export async function up(db: Knex): Promise<void> {
  await db.schema.alterTable("Subscription", (t) => {
    t.text("sync_id").unique();
    t.integer("sync_version").notNullable().defaultTo(1);
    t.boolean("deleted").notNullable().defaultTo(false);
    t.text("languages").notNullable().defaultTo("[]");
  });
  await db.schema.createTable("SubscriptionSyncChange", (t) => {
    t.increments("seq").primary(); t.text("kind").notNullable(); t.text("payload").notNullable();
  });
  await db.schema.createTable("SubscriptionRead", (t) => { t.bigInteger("gallery_id").primary(); });
  await db.schema.createTable("SubscriptionMutation", (t) => {
    t.text("device_id").notNullable(); t.text("mutation_id").notNullable(); t.text("request").notNullable();
    t.text("response").notNullable(); t.primary(["device_id", "mutation_id"]);
  });
  const payload = `json_object('id',sync_id,'name',coalesce(label,query),'query',query,'languages',json(languages),'enabled',json(CASE WHEN enabled THEN 'true' ELSE 'false' END),'deleted',json(CASE WHEN deleted THEN 'true' ELSE 'false' END),'version',sync_version)`;
  await db.raw("UPDATE Subscription SET sync_id=lower(hex(randomblob(16)))");
  await db.raw(`INSERT INTO SubscriptionSyncChange(kind,payload) SELECT 'subscription',${payload} FROM Subscription`);
  await db.raw(`CREATE TRIGGER subscription_sync_insert AFTER INSERT ON Subscription BEGIN
    UPDATE Subscription SET sync_id=coalesce(NEW.sync_id,lower(hex(randomblob(16)))) WHERE id=NEW.id;
    INSERT INTO SubscriptionSyncChange(kind,payload) SELECT 'subscription',${payload} FROM Subscription WHERE id=NEW.id;
  END`);
  await db.raw(`CREATE TRIGGER subscription_sync_update AFTER UPDATE OF query,label,enabled,languages,deleted ON Subscription
    WHEN NEW.query IS NOT OLD.query OR NEW.label IS NOT OLD.label OR NEW.enabled IS NOT OLD.enabled OR NEW.languages IS NOT OLD.languages OR NEW.deleted IS NOT OLD.deleted
    BEGIN
    UPDATE Subscription SET sync_version=OLD.sync_version+1 WHERE id=NEW.id;
    INSERT INTO SubscriptionSyncChange(kind,payload) SELECT 'subscription',${payload} FROM Subscription WHERE id=NEW.id;
  END`);
  await db.raw(`CREATE TRIGGER subscription_read_insert AFTER INSERT ON SubscriptionRead BEGIN
    INSERT INTO SubscriptionSyncChange(kind,payload) VALUES('read',json_object('galleryId',NEW.gallery_id));
  END`);
}

export async function down(db: Knex): Promise<void> {
  for (const name of ["subscription_sync_insert", "subscription_sync_update", "subscription_read_insert"]) await db.raw(`DROP TRIGGER IF EXISTS ${name}`);
  for (const name of ["SubscriptionMutation", "SubscriptionRead", "SubscriptionSyncChange"]) await db.schema.dropTable(name);
  await db.schema.alterTable("Subscription", (t) => { t.dropUnique(["sync_id"]); t.dropColumns("sync_id", "sync_version", "deleted", "languages"); });
}
