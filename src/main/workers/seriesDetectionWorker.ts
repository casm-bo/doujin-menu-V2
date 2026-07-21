import log from "electron-log";
import knex from "knex";
import { parentPort } from "worker_threads";
import type { Book } from "../db/types.js";
import { PrefixIndex } from "../services/seriesDetection/prefixIndex.js";
import type { SerializedIndexEntry } from "../services/seriesDetection/prefixIndex.js";
import { detectAndroidStyleSeriesCandidates } from "../services/seriesDetection/seriesDetector.js";
import type { DetectionOptions } from "../services/seriesDetection/types.js";

if (parentPort) {
  parentPort.on(
    "message",
    async (msg: {
      dbPath: string;
      options: Partial<DetectionOptions>;
      protectManualEdits: boolean;
    }) => {
      const { dbPath } = msg;

      // Worker 내부에서 DB 연결 생성
      const db = knex({
        client: "better-sqlite3",
        connection: { filename: dbPath },
        useNullAsDefault: true,
      });

      try {
        // 1. 기존 자동 시리즈 삭제
        // Android와 동일하게 기존 시리즈는 그대로 두고 미지정 책만 검사합니다.

        // 2. 시리즈에 속하지 않은 책 조회
        const books = await db("Book")
          .select(
            "Book.*",
            db.raw("GROUP_CONCAT(DISTINCT Artist.name) as artists"),
            db.raw("GROUP_CONCAT(DISTINCT Tag.name) as tags"),
          )
          .leftJoin("BookArtist", "Book.id", "BookArtist.book_id")
          .leftJoin("Artist", "BookArtist.artist_id", "Artist.id")
          .leftJoin("BookTag", "Book.id", "BookTag.book_id")
          .leftJoin("Tag", "BookTag.tag_id", "Tag.id")
          .whereNull("Book.series_collection_id")
          .groupBy("Book.id");

        // 3. 데이터 변환
        const booksWithArrays: Book[] = books.map(
          (
            book: Record<string, unknown> & { artists?: string; tags?: string },
          ) =>
            ({
              ...book,
              artists: book.artists
                ? book.artists
                    .split(",")
                    .map((name: string) => ({ id: 0, name }))
                : [],
              tags: book.tags
                ? book.tags
                    .split(",")
                    .map((name: string) => ({ id: 0, name, color: null }))
                : [],
            }) as Book,
        );

        // 4. 시리즈 감지 알고리즘 실행
        const existingSeries = await db("SeriesCollection").select("name");
        const result = await detectAndroidStyleSeriesCandidates(
          booksWithArrays,
          existingSeries.map((series) => series.name),
        );

        // 5. 감지된 시리즈 저장
        const createdSeries: { id: number; name: string }[] = [];
        for (const candidate of result.candidates) {
          await db.transaction(async (trx) => {
            const [seriesId] = await trx("SeriesCollection").insert({
              name: candidate.seriesName,
              is_auto_generated: true,
              is_manually_edited: false,
              confidence_score: candidate.confidence,
              created_at: trx.fn.now(),
              updated_at: trx.fn.now(),
            });

            for (const bookWithScore of candidate.books) {
              await trx("Book").where("id", bookWithScore.book.id).update({
                series_collection_id: seriesId,
                series_order_index: bookWithScore.orderIndex,
              });
            }

            createdSeries.push({ id: seriesId, name: candidate.seriesName });
          });
        }

        // 6. 빈 시리즈 정리
        // 7. PrefixIndex 구축 (메인 스레드 DB 조회 대체)
        let indexEntries: SerializedIndexEntry[] | null = null;
        try {
          // 전체 책 조회 (시리즈 할당 여부 관계없이)
          const allBooks = await db("Book")
            .select(
              "Book.*",
              db.raw("GROUP_CONCAT(DISTINCT Artist.name) as artists"),
              db.raw("GROUP_CONCAT(DISTINCT Tag.name) as tags"),
            )
            .leftJoin("BookArtist", "Book.id", "BookArtist.book_id")
            .leftJoin("Artist", "BookArtist.artist_id", "Artist.id")
            .leftJoin("BookTag", "Book.id", "BookTag.book_id")
            .leftJoin("Tag", "BookTag.tag_id", "Tag.id")
            .groupBy("Book.id");

          const allBooksWithArrays: Book[] = allBooks.map(
            (
              book: Record<string, unknown> & {
                artists?: string;
                tags?: string;
              },
            ) =>
              ({
                ...book,
                artists: book.artists
                  ? book.artists
                      .split(",")
                      .map((name: string) => ({ id: 0, name }))
                  : [],
                tags: book.tags
                  ? book.tags
                      .split(",")
                      .map((name: string) => ({ id: 0, name, color: null }))
                  : [],
              }) as Book,
          );

          // 전체 시리즈 + bookIds 조회 — JOIN 1회 쿼리로 N+1 해결
          const seriesRows = await db("SeriesCollection")
            .select(
              "SeriesCollection.id",
              "SeriesCollection.name",
              "Book.id as book_id",
            )
            .leftJoin(
              "Book",
              "Book.series_collection_id",
              "SeriesCollection.id",
            );

          const seriesMap = new Map<
            number,
            { id: number; name: string; bookIds: number[] }
          >();
          for (const row of seriesRows) {
            if (!seriesMap.has(row.id)) {
              seriesMap.set(row.id, {
                id: row.id,
                name: row.name,
                bookIds: [],
              });
            }
            if (row.book_id) {
              seriesMap.get(row.id)!.bookIds.push(row.book_id);
            }
          }
          const allSeriesData = [...seriesMap.values()];

          const index = new PrefixIndex();
          index.rebuild(allBooksWithArrays, allSeriesData);
          indexEntries = index.serialize();
        } catch (indexError) {
          log.error(
            "[Worker] PrefixIndex 구축 실패 (무시하고 계속):",
            indexError,
          );
        }

        parentPort?.postMessage({
          success: true,
          data: {
            created_count: createdSeries.length,
            processed_books: result.processedBooks,
            duration: result.duration,
            series: createdSeries,
            indexEntries,
          },
        });
      } catch (error) {
        log.error("[Worker] 시리즈 감지 실패:", error);
        parentPort?.postMessage({
          success: false,
          error: (error as Error).message,
        });
      } finally {
        // DB 연결 종료
        await db.destroy();
      }
    },
  );
}
