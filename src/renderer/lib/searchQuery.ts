export const toggleSearchTerm = (query: string, term: string): string => {
  const terms = query.split(" ").filter(Boolean);
  const index = terms.indexOf(term);

  if (index >= 0) {
    terms.splice(index, 1);
  } else {
    terms.push(term);
  }

  return terms.join(" ");
};
