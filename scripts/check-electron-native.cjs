const assert = require("node:assert/strict");
const { createRequire } = require("node:module");
const path = require("node:path");

assert.ok(process.versions.electron, "Run this check with Electron");

const { app } = require("electron");
const archive = process.argv[2] && path.resolve(process.argv[2]);
const nativeRequire = archive
  ? createRequire(path.join(archive, "package.json"))
  : require;

async function checkNativeModules() {
  if (archive) {
    for (const moduleName of ["better-sqlite3", "sharp"]) {
      assert.ok(
        nativeRequire.resolve(moduleName).startsWith(archive + path.sep),
      );
    }
  }
  const Database = nativeRequire("better-sqlite3");
  const db = new Database(":memory:");
  try {
    db.exec("CREATE TABLE smoke (value TEXT NOT NULL)");
    const insert = db.prepare("INSERT INTO smoke (value) VALUES (?)");
    db.transaction(() => insert.run("electron"))();
    assert.equal(db.prepare("SELECT value FROM smoke").get().value, "electron");
    assert.equal(db.pragma("integrity_check", { simple: true }), "ok");
  } finally {
    db.close();
  }
  const sharp = nativeRequire("sharp");
  const image = await sharp({
    create: { width: 4, height: 4, channels: 3, background: "white" },
  })
    .resize(2, 2)
    .png()
    .toBuffer();
  const metadata = await sharp(image).metadata();
  assert.equal(metadata.width, 2);
  assert.equal(metadata.height, 2);
  console.log(
    `SQLite and sharp verified in Electron ${process.versions.electron} (ABI ${process.versions.modules})`,
  );
}

checkNativeModules().then(
  () => app.exit(0),
  (error) => {
    console.error(error);
    app.exit(1);
  },
);
