/**
 * better-sqlite3 네이티브 모듈 런타임 전환 스크립트.
 *
 * 사용법:
 *   node scripts/rebuild-native.js            → Electron용 리빌드
 *   node scripts/rebuild-native.js --node     → 시스템 Node용 리빌드
 *
 * node_modules/.native-target 마커 파일로 현재 빌드 대상을 추적하여,
 * 이미 올바른 런타임이면 리빌드를 스킵한다.
 */

import { createRequire } from "module";
import { execSync } from "child_process";
import { readFileSync, writeFileSync } from "fs";
import { join } from "path";

const rootDir = join(import.meta.dirname, "..");
const markerPath = join(rootDir, "node_modules", ".native-target");
const target = process.argv.includes("--node") ? "node" : "electron";
const require = createRequire(import.meta.url);
const electronVersion =
  target === "electron" ? require("electron/package.json").version : null;
const marker = electronVersion ? `${target}:${electronVersion}` : target;

if (target === "node") {
  try {
    const Database = require("better-sqlite3");
    new Database(":memory:").close();
    writeFileSync(markerPath, marker);
    console.log("better-sqlite3: 이미 node용 (스킵)");
    process.exit(0);
  } catch {
    // ABI가 다르면 아래에서 Node용으로 다시 빌드
  }
} else {
  try {
    if (readFileSync(markerPath, "utf8").trim() === marker) {
      console.log(`better-sqlite3: 이미 ${target}용 (스킵)`);
      process.exit(0);
    }
  } catch {}
}

if (target === "electron") {
  console.log(`Rebuilding better-sqlite3 for Electron ${electronVersion}...`);
  execSync("pnpm rebuild better-sqlite3", {
    stdio: "inherit",
    env: {
      ...process.env,
      npm_config_runtime: "electron",
      npm_config_target: electronVersion,
    },
  });
} else {
  console.log("Rebuilding better-sqlite3 for Node.js...");
  execSync("pnpm rebuild better-sqlite3", { stdio: "inherit" });
}

writeFileSync(markerPath, marker);
