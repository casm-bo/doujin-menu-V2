import path from "path";

export function getDownloadStagingRoot(tempPath: string): string {
  return path.join(tempPath, "doujin-menu", "downloads");
}
