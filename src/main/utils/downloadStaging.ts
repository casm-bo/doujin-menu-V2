import fs from "fs/promises";
import path from "path";

export function getDownloadStagingRoot(tempPath: string): string {
  return path.join(tempPath, "doujin-menu", "downloads");
}

export function getDownloadStagingJobPath(
  tempPath: string,
  galleryId: number,
): string {
  return path.join(getDownloadStagingRoot(tempPath), String(galleryId));
}

const activeJobs = new Set<string>();

export function setDownloadStagingJobActive(
  jobPath: string,
  active: boolean,
): void {
  const resolvedPath = path.resolve(jobPath);
  if (active) activeJobs.add(resolvedPath);
  else activeJobs.delete(resolvedPath);
}

export async function clearInactiveDownloadStaging(
  tempPath: string,
): Promise<void> {
  const rootPath = getDownloadStagingRoot(tempPath);
  const entries = await fs
    .readdir(rootPath, { withFileTypes: true })
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return [];
      throw error;
    });

  await Promise.all(
    entries.map((entry) => {
      const entryPath = path.resolve(rootPath, entry.name);
      if (activeJobs.has(entryPath)) return Promise.resolve();
      return fs.rm(entryPath, { recursive: true, force: true });
    }),
  );
}

export async function publishStagedDownload(
  sourcePath: string,
  finalPath: string,
): Promise<void> {
  const pendingPath = `${finalPath}.part`;
  const existing = await fs
    .stat(finalPath)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ENOENT") return null;
      throw error;
    });
  if (existing)
    throw new Error(`다운로드 경로에 같은 이름이 있습니다: ${finalPath}`);

  await fs.rm(pendingPath, { recursive: true, force: true });
  await fs.mkdir(path.dirname(finalPath), { recursive: true });

  try {
    const sourceStats = await fs.stat(sourcePath);
    if (sourceStats.isDirectory()) {
      await fs.cp(sourcePath, pendingPath, {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
      if ((await fs.readdir(pendingPath)).length === 0) {
        throw new Error("복사된 책 폴더가 비어 있습니다.");
      }
    } else {
      await fs.copyFile(sourcePath, pendingPath);
      const pendingStats = await fs.stat(pendingPath);
      if (pendingStats.size !== sourceStats.size || pendingStats.size === 0) {
        throw new Error("복사된 압축 파일 크기가 올바르지 않습니다.");
      }
    }

    await fs.rename(pendingPath, finalPath);
    await fs.rm(sourcePath, { recursive: true, force: true });
  } catch (error) {
    await fs
      .rm(pendingPath, { recursive: true, force: true })
      .catch(() => undefined);
    throw error;
  }
}
