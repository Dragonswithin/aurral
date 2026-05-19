function normalizeText(value) {
  return String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitWords(value) {
  return normalizeText(value)
    .split(" ")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function getNormalizedText(value) {
  return normalizeText(value);
}

export function scoreTextMatch(left, right) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.includes(b) || b.includes(a)) return 92;
  const leftWords = new Set(splitWords(a));
  const rightWords = new Set(splitWords(b));
  if (leftWords.size === 0 || rightWords.size === 0) return 0;
  let overlap = 0;
  for (const word of leftWords) {
    if (rightWords.has(word)) overlap += 1;
  }
  const ratio =
    (2 * overlap) / Math.max(1, leftWords.size + rightWords.size);
  return Math.round(ratio * 100);
}

function getYear(value) {
  const match = String(value || "").match(/\b(19\d{2}|20\d{2})\b/);
  return match ? match[1] : null;
}

function typeRank(value) {
  if (value === "Album") return 0;
  if (value === "EP") return 1;
  if (value === "Single") return 2;
  return 3;
}

function bootlegPenalty(item) {
  const statuses = Array.isArray(item?.releaseStatuses) ? item.releaseStatuses : [];
  return statuses.some((status) => String(status || "").toLowerCase() === "bootleg")
    ? 1
    : 0;
}

export function rankArtistCandidates(query, candidates = []) {
  const normalizedQuery = normalizeText(query);
  return [...candidates].sort((left, right) => {
    const leftName = String(left?.name || "").trim();
    const rightName = String(right?.name || "").trim();
    const leftExact = normalizeText(leftName) === normalizedQuery ? 1 : 0;
    const rightExact = normalizeText(rightName) === normalizedQuery ? 1 : 0;
    if (leftExact !== rightExact) return rightExact - leftExact;

    const leftScore = Number(left?.score || 0);
    const rightScore = Number(right?.score || 0);
    if (leftScore !== rightScore) return rightScore - leftScore;

    const leftType = left?.type ? 1 : 0;
    const rightType = right?.type ? 1 : 0;
    if (leftType !== rightType) return rightType - leftType;

    const leftDisambiguation = left?.disambiguation ? 1 : 0;
    const rightDisambiguation = right?.disambiguation ? 1 : 0;
    if (leftDisambiguation !== rightDisambiguation) {
      return rightDisambiguation - leftDisambiguation;
    }

    return leftName.localeCompare(rightName);
  });
}

export function rankAlbumCandidates(
  albumTitle,
  candidates = [],
  { artistName = "", releaseYear = null } = {},
) {
  const normalizedArtist = normalizeText(artistName);
  const targetYear = getYear(releaseYear);
  return [...candidates].sort((left, right) => {
    const leftTitleScore = scoreTextMatch(left?.title, albumTitle);
    const rightTitleScore = scoreTextMatch(right?.title, albumTitle);
    if (leftTitleScore !== rightTitleScore) {
      return rightTitleScore - leftTitleScore;
    }

    const leftArtistScore = normalizedArtist
      ? scoreTextMatch(left?.artistName, artistName)
      : 0;
    const rightArtistScore = normalizedArtist
      ? scoreTextMatch(right?.artistName, artistName)
      : 0;
    if (leftArtistScore !== rightArtistScore) {
      return rightArtistScore - leftArtistScore;
    }

    const leftYear = getYear(left?.releaseDate);
    const rightYear = getYear(right?.releaseDate);
    const leftYearScore =
      targetYear && leftYear === targetYear ? 1 : targetYear && leftYear ? -1 : 0;
    const rightYearScore =
      targetYear && rightYear === targetYear
        ? 1
        : targetYear && rightYear
          ? -1
          : 0;
    if (leftYearScore !== rightYearScore) {
      return rightYearScore - leftYearScore;
    }

    const leftTypeRank = typeRank(left?.type);
    const rightTypeRank = typeRank(right?.type);
    if (leftTypeRank !== rightTypeRank) return leftTypeRank - rightTypeRank;

    const leftBootleg = bootlegPenalty(left);
    const rightBootleg = bootlegPenalty(right);
    if (leftBootleg !== rightBootleg) return leftBootleg - rightBootleg;

    const leftScore = Number(left?.score || 0);
    const rightScore = Number(right?.score || 0);
    if (leftScore !== rightScore) return rightScore - leftScore;

    return String(left?.title || "").localeCompare(String(right?.title || ""));
  });
}
