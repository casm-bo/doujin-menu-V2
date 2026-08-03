import type { Book } from "../../../types/ipc";

export function getSeriesResumeTarget(books: Book[]) {
  const fallback =
    books.find((book) => Number(book.current_page) > 1) || books[0];
  const readAt = (book?: Book) => Date.parse(book?.last_read_at || "") || 0;
  const book = books.reduce<Book | undefined>((latest, candidate) => {
    return readAt(candidate) > readAt(latest) ? candidate : latest;
  }, fallback);

  return book
    ? { book, page: Math.max(1, Number(book.current_page) || 1) }
    : null;
}
