/**
 * better-sqlite3 13의 Node-API 바이너리는 Node와 Electron이 공유하므로
 * 재컴파일 대신 로딩을 확인한다. Electron 검증은 check-electron-native.cjs에서 한다.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const Database = require("better-sqlite3");
new Database(":memory:").close();
console.log("better-sqlite3: Node-API binary verified");
