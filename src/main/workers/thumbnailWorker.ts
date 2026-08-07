import fs from "fs/promises";
import sharp from "sharp";
import { parentPort } from "worker_threads";

if (parentPort) {
  parentPort.on(
    "message",
    async (task: {
      sourcePath: string;
      thumbnailPath: string;
      bookId: number;
      tempSourcePath?: string;
      thumbnailDirPath: string;
    }) => {
      const {
        sourcePath,
        thumbnailPath,
        bookId,
        tempSourcePath,
        thumbnailDirPath,
      } = task;
      const pendingThumbnailPath = `${thumbnailPath}.tmp`;

      let result:
        | { status: "success"; bookId: number; thumbnailPath: string }
        | { status: "error"; bookId: number; error: string };

      try {
        // 썸네일 디렉토리가 없으면 생성 (워커 스레드에서 직접 처리)
        await fs.mkdir(thumbnailDirPath, { recursive: true });

        // 원본 이미지를 버퍼로 읽어 sharp에 전달하여 파일 핸들 문제를 방지
        const imageBuffer = await fs.readFile(sourcePath);
        await sharp(imageBuffer)
          .resize(512)
          .webp()
          .toFile(pendingThumbnailPath);
        await fs.copyFile(pendingThumbnailPath, thumbnailPath);

        result = { status: "success", bookId, thumbnailPath };
      } catch (error) {
        console.error(
          `[Worker] Failed to generate thumbnail for book ${bookId}:`,
          error,
        );
        result = {
          status: "error",
          bookId,
          error: (error as Error).message,
        };
      } finally {
        await fs.rm(pendingThumbnailPath, { force: true }).catch(() => {});
        if (tempSourcePath) {
          await fs.unlink(tempSourcePath).catch((unlinkError) => {
            console.warn(
              `[Worker] Failed to delete temporary source file ${tempSourcePath}:`,
              unlinkError,
            );
          });
        }
      }
      parentPort?.postMessage(result);
    },
  );
}
