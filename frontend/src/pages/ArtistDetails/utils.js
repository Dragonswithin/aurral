import {
  TAG_COLORS,
  allReleaseTypes,
  secondaryReleaseTypes,
} from "./constants";

export const getTagColor = (name) => {
  if (!name) return "#211f27";
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
};

export const getPopularityScale = (releaseGroups) => {
  if (!Array.isArray(releaseGroups) || releaseGroups.length === 0) {
    return { pivot: 0 };
  }
  const counts = releaseGroups
    .map((rg) => (typeof rg?.fans === "number" ? rg.fans : 0))
    .filter((value) => value > 0)
    .sort((a, b) => a - b);
  if (counts.length === 0) return { pivot: 0 };
  const mid = Math.floor(counts.length / 2);
  const pivot =
    counts.length % 2 === 0 ? (counts[mid - 1] + counts[mid]) / 2 : counts[mid];
  return { pivot };
};

export const segmentsFromScale = (count, pivot, totalSegments = 10) => {
  const safeCount = typeof count === "number" ? count : 0;
  if (safeCount <= 0) return 0;
  const safePivot = Number.isFinite(pivot) && pivot > 0 ? pivot : safeCount;
  const logRatio = Math.log(safeCount / safePivot);
  const slope = 0.6;
  const scaled = 1 / (1 + Math.exp(-slope * logRatio));
  const clamped = Math.min(1, Math.max(0, scaled));
  return Math.round(clamped * totalSegments);
};

export const deduplicateAlbums = (albums) => {
  const seen = new Map();
  return albums.filter((album) => {
    const key = album.id || `${album.mbid}-${album.artistId}`;
    if (seen.has(key)) return false;
    seen.set(key, true);
    return true;
  });
};

export const formatLifeSpan = (lifeSpan) => {
  if (!lifeSpan) return null;
  const { begin, end, ended } = lifeSpan;
  if (!begin) return null;
  const beginYear = begin.split("-")[0];
  if (ended && end) {
    const endYear = end.split("-")[0];
    return `${beginYear} - ${endYear}`;
  }
  return `${beginYear} - Present`;
};

export const getArtistType = (type) => {
  const types = {
    Person: "Solo Artist",
    Group: "Band",
    Orchestra: "Orchestra",
    Choir: "Choir",
    Character: "Character",
    Other: "Other",
  };
  return types[type] || type;
};

export const matchesReleaseTypeFilter = (
  releaseGroup,
  selectedReleaseTypes,
) => {
  if (!selectedReleaseTypes || selectedReleaseTypes.length === 0) return true;
  const primaryType = releaseGroup["primary-type"];
  const secondaryTypes = releaseGroup["secondary-types"] || [];
  if (!selectedReleaseTypes.includes(primaryType)) return false;
  if (secondaryTypes.length > 0) {
    const normalizedSecondaryTypes = [
      ...new Set(
        secondaryTypes.map((secondaryType) =>
          secondaryReleaseTypes.includes(secondaryType)
            ? secondaryType
            : "Other",
        ),
      ),
    ];
    return normalizedSecondaryTypes.every((secondaryType) =>
      selectedReleaseTypes.includes(secondaryType),
    );
  }
  return true;
};

export const hasActiveFilters = (selectedReleaseTypes) => {
  if (selectedReleaseTypes.length !== allReleaseTypes.length) return true;
  return !allReleaseTypes.every((type) => selectedReleaseTypes.includes(type));
};

export const getCoverImage = (coverImages) => {
  if (!coverImages?.length) return null;
  const front = coverImages.find((img) => img.front);
  return front?.image || coverImages[0]?.image;
};

export const encodeLastfmPathSegment = (value) =>
  encodeURIComponent(String(value || "").trim())
    .replace(/%20/g, "+")
    .replace(/%26/g, "&");

export const buildLastfmArtistUrl = (artistName) =>
  `https://www.last.fm/music/${encodeLastfmPathSegment(artistName)}`;

export const buildLastfmAlbumUrl = (artistName, albumTitle) =>
  `${buildLastfmArtistUrl(artistName)}/${encodeLastfmPathSegment(albumTitle)}`;
