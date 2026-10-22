import { app } from "electron";
import { mkdirSync } from "fs";
import path from "path";

// Keep existing libraries, pairing keys and settings across the brand change.
const userData = path.join(app.getPath("appData"), "doujin-menu");
mkdirSync(userData, { recursive: true });
app.setPath("userData", userData);
