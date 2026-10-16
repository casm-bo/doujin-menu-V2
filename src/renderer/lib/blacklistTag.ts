export const BLACKLIST_TYPES = [
  "tag",
  "male",
  "female",
  "artist",
  "group",
  "character",
  "series",
  "type",
  "language",
] as const;

export type BlacklistType = (typeof BLACKLIST_TYPES)[number];

const TAG_NAME_PATTERN = /^[a-z0-9][a-z0-9-_.]*$/;

export const normalizeTagName = (raw: string): string =>
  raw.trim().toLowerCase().replace(/\s+/g, "_");

export type ParseResult =
  | { ok: true; entry: string }
  | { ok: false; error: string };

export const buildBlacklistEntry = (
  type: string,
  rawName: string,
): ParseResult => {
  const name = normalizeTagName(rawName);

  if (!name) {
    return { ok: false, error: "태그 이름을 입력해주세요." };
  }
  if (!TAG_NAME_PATTERN.test(name)) {
    return {
      ok: false,
      error: "영문 소문자·숫자와 - _ . 만 쓸 수 있습니다. (한글 불가)",
    };
  }
  if (!(BLACKLIST_TYPES as readonly string[]).includes(type)) {
    return { ok: false, error: `쓸 수 없는 타입입니다: ${type}` };
  }

  return { ok: true, entry: `${type}:${name}` };
};

export const parseBlacklistInput = (raw: string): ParseResult => {
  const trimmed = raw.trim().replace(/^-/, "");

  if (!trimmed) {
    return { ok: false, error: "차단할 태그를 입력해주세요." };
  }

  const colonAt = trimmed.indexOf(":");
  if (colonAt === -1) {
    return buildBlacklistEntry("tag", trimmed);
  }

  const type = trimmed.slice(0, colonAt).trim().toLowerCase();
  const name = trimmed.slice(colonAt + 1);
  return buildBlacklistEntry(type, name);
};
