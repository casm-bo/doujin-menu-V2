import { app } from "electron";
import { mkdirSync } from "fs";
import path from "path";

// Keep this app's database and settings separate from the original app.
const userData = path.join(app.getPath("appData"), "doujinzip");
mkdirSync(userData, { recursive: true });
app.setPath("userData", userData);
