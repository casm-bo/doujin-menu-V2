import { hitomi, type Tag } from "node-hitomi";

/**
 * 태그 하나의 갤러리 ID를 node-hitomi 9의 공개 API로 조회합니다.
 * 라이브러리 내부 URL 조립 함수에 의존하지 않아 업데이트에 안전합니다.
 */
export const fetchTagIds = async (tag: Tag): Promise<number[]> => {
  const positiveTag = hitomi.tags.create(tag.type, tag.name);
  const references = await hitomi.galleries.list({ tags: [positiveTag] });
  return references.map((reference) => reference.id);
};
