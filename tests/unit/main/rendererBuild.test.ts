import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { build } from "vite";
import { expect, it } from "vitest";

it("builds renderer assets that resolve beside a file:// entry point", async () => {
  const root = await mkdtemp(join(tmpdir(), "doujin-menu-renderer-"));
  try {
    await writeFile(
      join(root, "index.html"),
      '<div id="app"></div><script type="module" src="./main.js"></script>',
    );
    await writeFile(join(root, "main.js"), 'import "./style.css";');
    await writeFile(join(root, "style.css"), "body { color: red; }");
    await build({
      configFile: fileURLToPath(
        new URL("../../../vite.config.js", import.meta.url),
      ),
      root,
      publicDir: false,
      logLevel: "silent",
      build: { outDir: join(root, "dist") },
    });
    const entry = join(root, "dist", "index.html");
    const html = await readFile(entry, "utf8");
    const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)];
    expect(assets).toHaveLength(2);
    for (const [, reference] of assets) {
      expect(reference).toMatch(/^\.\//);
      const assetPath = fileURLToPath(new URL(reference, pathToFileURL(entry)));
      expect(existsSync(assetPath)).toBe(true);
    }
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
