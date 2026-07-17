import path from "path";

export function isPathWithinLibraryRoot(
  candidatePath: string,
  libraryRoot: string,
): boolean {
  const pathApi = /^[a-z]:[\\/]/i.test(candidatePath + libraryRoot)
    ? path.win32
    : path;
  const root = pathApi.resolve(libraryRoot);
  const candidate = pathApi.resolve(candidatePath);
  const relative = pathApi.relative(root, candidate);
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${pathApi.sep}`) &&
      !pathApi.isAbsolute(relative))
  );
}

export function filterLibraryPathRows<T extends { path: string }>(
  rows: T[],
  libraryRoot: string,
): T[] {
  return rows.filter((row) => isPathWithinLibraryRoot(row.path, libraryRoot));
}
