import NodeCache from "node-cache";
import axios from "axios";
import { dbOps } from "../config/db-helpers.js";
import { getMusicbrainzApiBaseUrl, musicbrainzRequest } from "./apiClients.js";
import { getDiscoveryCache } from "./discoveryService.js";
import { primeArtistImageCache } from "./artistImageHydration.js";
import { buildImageProxyUrl } from "./imageProxyService.js";
import { lidarrClient } from "./lidarrClient.js";

const PRIMARY_RELEASE_TYPES = new Set(["Album", "EP", "Single"]);
const SECONDARY_RELEASE_TYPES = new Set([
  "Live",
  "Remix",
  "Compilation",
  "Demo",
  "Broadcast",
  "Soundtrack",
  "Spokenword",
  "Other",
]);
const ALL_RELEASE_TYPES = new Set([
  ...PRIMARY_RELEASE_TYPES,
  ...SECONDARY_RELEASE_TYPES,
]);
const ALBUM_SEARCH_SORT_OPTIONS = new Set([
  "relevance",
  "dateDesc",
  "artistAsc",
  "titleAsc",
]);
const ALBUM_SORT_WINDOW = 120;
const ALBUM_SORT_PAGE_SIZE = 50;
const ALBUM_SORT_MAX_PAGES = 6;
const ALBUM_SORT_COLLATOR = new Intl.Collator(undefined, {
  sensitivity: "base",
  numeric: true,
});
const SECONDARY_TYPE_PENALTIES = new Map([
  ["Live", 1],
  ["Demo", 2],
  ["Remix", 3],
  ["Compilation", 4],
  ["Soundtrack", 5],
  ["Broadcast", 6],
  ["Spokenword", 7],
  ["Other", 8],
]);
const albumLibraryLookupCache = new NodeCache({
  stdTTL: 60,
  checkperiod: 60,
  maxKeys: 10,
});
const MUSICBRAINZ_TAG_PAGE_CACHE_TTL_SECONDS = 15 * 60;
const musicbrainzTagPageCache = new NodeCache({
  stdTTL: MUSICBRAINZ_TAG_PAGE_CACHE_TTL_SECONDS,
  checkperiod: 120,
  maxKeys: 500,
});

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function escapeMusicbrainzQueryTerm(value) {
  return String(value || "").replace(/["\\]/g, "\\$&");
}

function normalizeTagValue(value) {
  return String(value || "").trim().toLowerCase();
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec) =>
      String.fromCodePoint(Number.parseInt(dec, 10)),
    );
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getMusicbrainzSiteBaseUrl() {
  const apiBaseUrl = String(getMusicbrainzApiBaseUrl() || "").trim();
  if (!apiBaseUrl) {
    return "https://mb.lkly.net";
  }

  try {
    const parsed = new URL(apiBaseUrl);
    parsed.pathname = parsed.pathname.replace(/\/ws\/2\/?$/, "") || "/";
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/+$/, "");
  } catch {
    return "https://mb.lkly.net";
  }
}

function normalizePercentOfTracks(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  if (raw > 1 && raw <= 100) return Math.round(raw);
  if (raw <= 1) return Math.round(raw * 100);
  return Math.min(100, Math.round(raw / 10));
}

function normalizeArtistImage(cachedImage) {
  return cachedImage?.imageUrl && cachedImage.imageUrl !== "NOT_FOUND"
    ? cachedImage.imageUrl
    : null;
}

function normalizeReleaseGroupCover(cachedImage) {
  return cachedImage?.imageUrl && cachedImage.imageUrl !== "NOT_FOUND"
    ? buildImageProxyUrl(cachedImage.imageUrl) || cachedImage.imageUrl
    : null;
}

export function normalizeArtistSearchItem(artist, cachedImages = {}) {
  const rawImageUrl = normalizeArtistImage(cachedImages[artist.id]);
  const imageUrl = rawImageUrl
    ? buildImageProxyUrl(rawImageUrl) || rawImageUrl
    : null;
  const areaName =
    artist?.area?.name || artist?.["begin-area"]?.name || artist?.area || null;
  const lifeSpan = artist?.["life-span"] || artist?.lifeSpan || null;
  const begin = lifeSpan?.begin || null;
  const end = lifeSpan?.end || null;
  return {
    type: "artist",
    id: artist.id,
    name: artist.name,
    sortName: artist["sort-name"] || artist.name,
    image: imageUrl,
    imageUrl,
    artistType: artist.type || null,
    country: artist.country || null,
    area: areaName,
    begin,
    end,
    disambiguation: artist.disambiguation || null,
    inLibrary: false,
  };
}

function normalizeArtistCredit(artistCredit) {
  const credits = Array.isArray(artistCredit) ? artistCredit : [];
  let artistName = "";
  let artistMbid = null;

  for (const credit of credits) {
    if (typeof credit === "string") {
      artistName += credit;
      continue;
    }
    if (!credit || typeof credit !== "object") continue;
    const name = credit.name || credit.artist?.name || "";
    const joinPhrase = credit.joinphrase || "";
    artistName += `${name}${joinPhrase}`;
    if (!artistMbid && credit.artist?.id) {
      artistMbid = credit.artist.id;
    }
  }

  return {
    artistName: artistName.trim() || null,
    artistMbid,
  };
}

function getReleaseGroupArtistName(releaseGroup) {
  return normalizeArtistCredit(releaseGroup?.["artist-credit"]).artistName || "";
}

function getReleaseGroupScore(releaseGroup) {
  return Number.parseInt(releaseGroup?.score, 10) || 0;
}

function getReleaseGroupDateSortValue(releaseGroup) {
  const value = String(releaseGroup?.["first-release-date"] || "").trim();
  if (!value) return -1;
  const [yearPart = "", monthPart = "", dayPart = ""] = value.split("-");
  const year = Number.parseInt(yearPart, 10);
  if (!Number.isFinite(year) || year <= 0) return -1;
  const month = Number.parseInt(monthPart, 10);
  const day = Number.parseInt(dayPart, 10);
  const normalizedMonth =
    Number.isFinite(month) && month >= 1 && month <= 12 ? month : 0;
  const normalizedDay =
    Number.isFinite(day) && day >= 1 && day <= 31 ? day : 0;
  return year * 10000 + normalizedMonth * 100 + normalizedDay;
}

function isVariousArtistsReleaseGroup(releaseGroup) {
  return normalizeSearchText(getReleaseGroupArtistName(releaseGroup)) ===
    "various artists";
}

function getPrimaryTypeRank(releaseGroup) {
  const primaryType = String(releaseGroup?.["primary-type"] || "");
  if (primaryType === "Album") return 0;
  if (primaryType === "EP") return 1;
  if (primaryType === "Single") return 2;
  return 3;
}

function getSecondaryTypePenalty(releaseGroup) {
  const secondaryTypes = Array.isArray(releaseGroup?.["secondary-types"])
    ? releaseGroup["secondary-types"]
    : [];
  if (secondaryTypes.length === 0) return 0;
  return secondaryTypes.reduce((highestPenalty, secondaryType) => {
    const normalizedType = SECONDARY_RELEASE_TYPES.has(secondaryType)
      ? secondaryType
      : "Other";
    const penalty = SECONDARY_TYPE_PENALTIES.get(normalizedType) || 8;
    return Math.max(highestPenalty, penalty);
  }, 0);
}

function getTitleMatchRank(releaseGroup, normalizedQuery) {
  if (!normalizedQuery) return 3;
  const normalizedTitle = normalizeSearchText(releaseGroup?.title);
  if (!normalizedTitle) return 3;
  if (normalizedTitle === normalizedQuery) return 0;
  if (normalizedTitle.startsWith(normalizedQuery)) return 1;
  if (normalizedTitle.includes(normalizedQuery)) return 2;
  return 3;
}

function compareStrings(left, right) {
  return ALBUM_SORT_COLLATOR.compare(String(left || ""), String(right || ""));
}

function compareReleaseDatesDesc(left, right) {
  const leftValue = getReleaseGroupDateSortValue(left);
  const rightValue = getReleaseGroupDateSortValue(right);
  if (leftValue === rightValue) return 0;
  if (leftValue < 0) return 1;
  if (rightValue < 0) return -1;
  return rightValue - leftValue;
}

function compareReleaseGroupsByRelevance(left, right, normalizedQuery) {
  const leftTitleMatchRank = getTitleMatchRank(left, normalizedQuery);
  const rightTitleMatchRank = getTitleMatchRank(right, normalizedQuery);
  if (leftTitleMatchRank !== rightTitleMatchRank) {
    return leftTitleMatchRank - rightTitleMatchRank;
  }

  const leftScore = getReleaseGroupScore(left);
  const rightScore = getReleaseGroupScore(right);
  if (leftScore !== rightScore) {
    return rightScore - leftScore;
  }

  const leftPrimaryTypeRank = getPrimaryTypeRank(left);
  const rightPrimaryTypeRank = getPrimaryTypeRank(right);
  if (leftPrimaryTypeRank !== rightPrimaryTypeRank) {
    return leftPrimaryTypeRank - rightPrimaryTypeRank;
  }

  const leftSecondaryPenalty = getSecondaryTypePenalty(left);
  const rightSecondaryPenalty = getSecondaryTypePenalty(right);
  if (leftSecondaryPenalty !== rightSecondaryPenalty) {
    return leftSecondaryPenalty - rightSecondaryPenalty;
  }

  const leftVariousArtists = isVariousArtistsReleaseGroup(left) ? 1 : 0;
  const rightVariousArtists = isVariousArtistsReleaseGroup(right) ? 1 : 0;
  if (leftVariousArtists !== rightVariousArtists) {
    return leftVariousArtists - rightVariousArtists;
  }

  const dateComparison = compareReleaseDatesDesc(left, right);
  if (dateComparison !== 0) {
    return dateComparison;
  }

  const artistComparison = compareStrings(
    getReleaseGroupArtistName(left),
    getReleaseGroupArtistName(right),
  );
  if (artistComparison !== 0) {
    return artistComparison;
  }

  const titleComparison = compareStrings(left?.title, right?.title);
  if (titleComparison !== 0) {
    return titleComparison;
  }

  return compareStrings(left?.id, right?.id);
}

export function normalizeAlbumSearchSort(value) {
  const normalized = String(value || "").trim();
  return ALBUM_SEARCH_SORT_OPTIONS.has(normalized) ? normalized : "relevance";
}

export function sortAlbumSearchResults(
  releaseGroups,
  query,
  sort = "relevance",
) {
  const normalizedQuery = normalizeSearchText(query);
  const normalizedSort = normalizeAlbumSearchSort(sort);
  const source = Array.isArray(releaseGroups) ? [...releaseGroups] : [];

  return source.sort((left, right) => {
    if (normalizedSort === "dateDesc") {
      const dateComparison = compareReleaseDatesDesc(left, right);
      if (dateComparison !== 0) return dateComparison;
      const titleComparison = compareStrings(left?.title, right?.title);
      if (titleComparison !== 0) return titleComparison;
      const artistComparison = compareStrings(
        getReleaseGroupArtistName(left),
        getReleaseGroupArtistName(right),
      );
      if (artistComparison !== 0) return artistComparison;
      return compareStrings(left?.id, right?.id);
    }

    if (normalizedSort === "artistAsc") {
      const artistComparison = compareStrings(
        getReleaseGroupArtistName(left),
        getReleaseGroupArtistName(right),
      );
      if (artistComparison !== 0) return artistComparison;
      const titleComparison = compareStrings(left?.title, right?.title);
      if (titleComparison !== 0) return titleComparison;
      const dateComparison = compareReleaseDatesDesc(left, right);
      if (dateComparison !== 0) return dateComparison;
      return compareStrings(left?.id, right?.id);
    }

    if (normalizedSort === "titleAsc") {
      const titleComparison = compareStrings(left?.title, right?.title);
      if (titleComparison !== 0) return titleComparison;
      const artistComparison = compareStrings(
        getReleaseGroupArtistName(left),
        getReleaseGroupArtistName(right),
      );
      if (artistComparison !== 0) return artistComparison;
      const dateComparison = compareReleaseDatesDesc(left, right);
      if (dateComparison !== 0) return dateComparison;
      return compareStrings(left?.id, right?.id);
    }

    return compareReleaseGroupsByRelevance(left, right, normalizedQuery);
  });
}

export function normalizeAlbumSearchItem(
  releaseGroup,
  lookup = null,
  cachedCovers = {},
) {
  const artistCredit = normalizeArtistCredit(releaseGroup["artist-credit"]);
  const coverUrl = normalizeReleaseGroupCover(cachedCovers[releaseGroup.id]);
  return {
    type: "album",
    id: releaseGroup.id,
    title: releaseGroup.title || "Untitled Release",
    artistName: artistCredit.artistName || "Unknown Artist",
    artistMbid: artistCredit.artistMbid,
    releaseDate: releaseGroup["first-release-date"] || null,
    primaryType: releaseGroup["primary-type"] || null,
    secondaryTypes: Array.isArray(releaseGroup["secondary-types"])
      ? releaseGroup["secondary-types"]
      : [],
    coverUrl,
    inLibrary: !!lookup,
    libraryAlbumId: lookup?.libraryAlbumId || null,
    libraryArtistId: lookup?.libraryArtistId || null,
    status: lookup?.status || "missing",
  };
}

export function normalizeAlbumReleaseTypesFilter(releaseTypes) {
  const values = Array.isArray(releaseTypes)
    ? releaseTypes
    : String(releaseTypes || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
  return [...new Set(values.filter((value) => ALL_RELEASE_TYPES.has(value)))];
}

export function matchesAlbumReleaseTypeFilter(
  releaseGroup,
  selectedReleaseTypes,
) {
  const normalizedSelection =
    normalizeAlbumReleaseTypesFilter(selectedReleaseTypes);
  if (
    normalizedSelection.length === 0 ||
    normalizedSelection.length === ALL_RELEASE_TYPES.size
  ) {
    return true;
  }

  const selected = new Set(normalizedSelection);
  const primaryType = releaseGroup?.["primary-type"];
  const secondaryTypes = Array.isArray(releaseGroup?.["secondary-types"])
    ? releaseGroup["secondary-types"]
    : [];

  if (!selected.has(primaryType)) return false;
  if (secondaryTypes.length === 0) return true;

  const normalizedSecondaryTypes = [
    ...new Set(
      secondaryTypes.map((secondaryType) =>
        SECONDARY_RELEASE_TYPES.has(secondaryType) ? secondaryType : "Other",
      ),
    ),
  ];

  return normalizedSecondaryTypes.every((secondaryType) =>
    selected.has(secondaryType),
  );
}

function buildAlbumSearchQuery(query, selectedReleaseTypes) {
  const normalizedQuery = String(query || "").trim();
  const normalizedSelection =
    normalizeAlbumReleaseTypesFilter(selectedReleaseTypes);
  const primarySelection = normalizedSelection.filter((value) =>
    PRIMARY_RELEASE_TYPES.has(value),
  );
  const secondarySelection = normalizedSelection.filter((value) =>
    SECONDARY_RELEASE_TYPES.has(value),
  );

  if (
    primarySelection.length === 0 ||
    primarySelection.length === PRIMARY_RELEASE_TYPES.size
  ) {
    return normalizedQuery;
  }

  const primaryClauses = primarySelection.map(
    (value) => `primarytype:${value.toLowerCase()}`,
  );
  const escapedQuery = escapeMusicbrainzQueryTerm(normalizedQuery);
  const clauses = [`"${escapedQuery}"`, `(${primaryClauses.join(" OR ")})`];

  if (secondarySelection.length === 0) {
    clauses.push("-secondarytype:*");
  }

  return clauses.join(" AND ");
}

async function fetchMusicbrainzTagArtistPage(tag, page) {
  const cacheKey = `tag-page:${normalizeTagValue(tag)}:${page}`;
  const cached = musicbrainzTagPageCache.get(cacheKey);
  if (cached) return cached;
  const normalizedTag = encodeURIComponent(String(tag || "").trim());
  const url = `${getMusicbrainzSiteBaseUrl()}/tag/${normalizedTag}/artist?page=${page}`;
  const response = await axios.get(url, {
    timeout: 15000,
    headers: {
      "User-Agent": "Aurral Tag Search",
      Accept: "text/html,application/xhtml+xml",
    },
  });
  const html = String(response.data || "");
  const countMatch = html.match(/<p>([\d,]+)\s+artists found<\/p>/i);
  const totalCount = Number.parseInt(
    String(countMatch?.[1] || "0").replace(/,/g, ""),
    10,
  ) || 0;
  const itemPattern =
    /<li>(\d+)\s*-\s*<a href="\/artist\/([0-9a-f-]+)" title="([^"]*)"><bdi>(.*?)<\/bdi><\/a>(?:\s*<span class="comment">\(<bdi>(.*?)<\/bdi>\)<\/span>)?<\/li>/gisu;
  const items = [];
  let match;
  while ((match = itemPattern.exec(html)) !== null) {
    items.push({
      id: match[2],
      name: decodeHtmlEntities(match[4] || match[3] || ""),
      sortName: decodeHtmlEntities(match[4] || match[3] || ""),
      disambiguation: decodeHtmlEntities(match[5] || ""),
      tagCount: Number.parseInt(match[1], 10) || 0,
      type: "artist",
    });
  }

  const result = {
    totalCount,
    items,
    pageSize: items.length,
  };
  musicbrainzTagPageCache.set(cacheKey, result);
  return result;
}

async function searchTagsAllFallbackViaArtistSearch(tag, limitInt, offsetInt) {
  const mbData = await musicbrainzRequest("/artist", {
    query: `tag:"${escapeMusicbrainzQueryTerm(tag)}"`,
    limit: limitInt,
    offset: offsetInt,
  });
  const artists = Array.isArray(mbData?.artists) ? mbData.artists : [];
  const filteredArtists = artists.filter((artist) => artist?.id);
  const cachedImages = dbOps.getImages(filteredArtists.map((artist) => artist.id));
  const items = filteredArtists.map((artist) => ({
    ...normalizeArtistSearchItem(artist, cachedImages),
    tags: [tag],
  }));
  primeArtistImageCache(items.slice(0, Math.min(items.length, limitInt))).catch(
    () => {},
  );
  return {
    scope: "tag",
    query: tag,
    count: Number.parseInt(mbData?.count, 10) || items.length,
    hasMore:
      (Number.parseInt(mbData?.count, 10) || items.length) >
      offsetInt + items.length,
    offset: offsetInt,
    items,
  };
}

function canUseDirectPrimaryTypeSearch(selectedReleaseTypes) {
  const normalizedSelection =
    normalizeAlbumReleaseTypesFilter(selectedReleaseTypes);
  if (
    normalizedSelection.length === 0 ||
    normalizedSelection.length === ALL_RELEASE_TYPES.size
  ) {
    return false;
  }

  return normalizedSelection.every((value) => PRIMARY_RELEASE_TYPES.has(value));
}

function normalizeTagArtistItem(artist, tag) {
  let imageUrl =
    typeof artist.imageUrl === "string" && artist.imageUrl.trim()
      ? artist.imageUrl.trim()
      : typeof artist.image === "string" && artist.image.trim()
        ? artist.image.trim()
        : null;
  if (!imageUrl && Array.isArray(artist.image)) {
    const img =
      artist.image.find((entry) => entry.size === "extralarge") ||
      artist.image.find((entry) => entry.size === "large") ||
      artist.image.slice(-1)[0];
    if (
      img?.["#text"] &&
      !img["#text"].includes("2a96cbd8b46e442fc41c2b86b821562f")
    ) {
      imageUrl = img["#text"];
    }
  }

  const proxiedImageUrl = imageUrl ? buildImageProxyUrl(imageUrl) || imageUrl : null;

  return {
    type: "artist",
    id: artist.id || artist.mbid,
    name: artist.name,
    sortName: artist.sortName || artist.name,
    image: proxiedImageUrl,
    imageUrl: proxiedImageUrl,
    inLibrary: false,
    tags: [tag],
  };
}

async function getAlbumLibraryLookup(albumMbids) {
  const lookup = new Map();
  if (!lidarrClient.isConfigured() || albumMbids.length === 0) {
    return lookup;
  }

  try {
    let lidarrAlbums = albumLibraryLookupCache.get("lidarrAlbums");
    if (!lidarrAlbums) {
      return lookup;
    }
    const wanted = new Set(albumMbids);
    for (const album of Array.isArray(lidarrAlbums) ? lidarrAlbums : []) {
      const foreignAlbumId = album?.foreignAlbumId;
      if (!foreignAlbumId || !wanted.has(foreignAlbumId)) continue;
      const percentOfTracks = normalizePercentOfTracks(
        album?.statistics?.percentOfTracks,
      );
      const sizeOnDisk = Number(album?.statistics?.sizeOnDisk || 0);
      lookup.set(foreignAlbumId, {
        inLibrary: true,
        libraryAlbumId:
          album.id !== undefined && album.id !== null ? String(album.id) : null,
        libraryArtistId:
          album.artistId !== undefined && album.artistId !== null
            ? String(album.artistId)
            : null,
        status:
          percentOfTracks >= 100 || sizeOnDisk > 0 ? "available" : "inLibrary",
      });
    }
  } catch (error) {
    console.warn("Album search enrichment failed:", error.message);
  }

  return lookup;
}

export async function searchArtists(query, limit = 24, offset = 0) {
  const limitInt = parsePositiveInt(limit, 24);
  const offsetInt = Math.max(0, Number.parseInt(offset, 10) || 0);
  const mbData = await musicbrainzRequest("/artist", {
    query,
    limit: limitInt,
    offset: offsetInt,
  });
  const artists = Array.isArray(mbData?.artists) ? mbData.artists : [];
  const filteredArtists = artists.filter((artist) => artist?.id);
  const cachedImages = dbOps.getImages(filteredArtists.map((artist) => artist.id));
  const items = filteredArtists.map((artist) =>
    normalizeArtistSearchItem(artist, cachedImages),
  );
  primeArtistImageCache(items.slice(0, Math.min(items.length, limitInt))).catch(
    () => {},
  );

  return {
    scope: "artist",
    query,
    count: Number.parseInt(mbData?.count, 10) || items.length,
    offset: offsetInt,
    items,
  };
}

export async function searchArtistsLegacy(query, limit = 24, offset = 0) {
  const result = await searchArtists(query, limit, offset);
  return {
    artists: result.items.map((artist) => ({
      id: artist.id,
      name: artist.name,
      "sort-name": artist.sortName,
      image: artist.imageUrl,
      imageUrl: artist.imageUrl,
      listeners: null,
    })),
    count: result.count,
    offset: result.offset,
  };
}

export async function searchAlbums(
  query,
  limit = 24,
  offset = 0,
  releaseTypes = [],
  sort = "relevance",
) {
  const limitInt = parsePositiveInt(limit, 24);
  const offsetInt = Math.max(0, Number.parseInt(offset, 10) || 0);
  const selectedReleaseTypes = normalizeAlbumReleaseTypesFilter(releaseTypes);
  const normalizedSort = normalizeAlbumSearchSort(sort);
  const useDirectPrimaryTypeSearch =
    canUseDirectPrimaryTypeSearch(selectedReleaseTypes);
  const shouldFilterByReleaseType =
    !useDirectPrimaryTypeSearch &&
    selectedReleaseTypes.length > 0 &&
    selectedReleaseTypes.length < ALL_RELEASE_TYPES.size;
  const musicbrainzQuery = buildAlbumSearchQuery(query, selectedReleaseTypes);
  const candidateWindow = Math.max(limitInt + offsetInt, ALBUM_SORT_WINDOW);
  let pagesFetched = 0;
  const rawPageSize = Math.max(limitInt, ALBUM_SORT_PAGE_SIZE);
  let rawOffset = 0;
  let rawCount = 0;
  const candidateReleaseGroups = [];

  while (candidateReleaseGroups.length < candidateWindow) {
    if (pagesFetched >= ALBUM_SORT_MAX_PAGES) {
      break;
    }
    const mbData = await musicbrainzRequest("/release-group", {
      query: musicbrainzQuery,
      limit: rawPageSize,
      offset: rawOffset,
    });
    pagesFetched += 1;
    rawCount =
      Number.parseInt(mbData?.count, 10) ||
      Number.parseInt(mbData?.["release-group-count"], 10) ||
      rawCount;
    const releaseGroups = Array.isArray(mbData?.["release-groups"])
      ? mbData["release-groups"]
      : [];
    const validReleaseGroups = releaseGroups.filter(
      (releaseGroup) => releaseGroup?.id && releaseGroup?.title,
    );

    for (const releaseGroup of validReleaseGroups) {
      if (
        shouldFilterByReleaseType &&
        !matchesAlbumReleaseTypeFilter(releaseGroup, selectedReleaseTypes)
      ) {
        continue;
      }
      candidateReleaseGroups.push(releaseGroup);
      if (candidateReleaseGroups.length >= candidateWindow) {
        break;
      }
    }

    if (candidateReleaseGroups.length >= candidateWindow) {
      break;
    }
    if (validReleaseGroups.length === 0) {
      break;
    }
    rawOffset += releaseGroups.length;
    if (rawCount > 0 && rawOffset >= rawCount) {
      break;
    }
  }

  const sortedReleaseGroups = sortAlbumSearchResults(
    candidateReleaseGroups,
    query,
    normalizedSort,
  );
  const pagedReleaseGroups = sortedReleaseGroups.slice(
    offsetInt,
    offsetInt + limitInt,
  );
  const albumLookup = await getAlbumLibraryLookup(
    pagedReleaseGroups.map((releaseGroup) => releaseGroup.id),
  );
  const cachedCovers = dbOps.getImages(
    pagedReleaseGroups.map((releaseGroup) => `rg:${releaseGroup.id}`),
  );

  return {
    scope: "album",
    query,
    sort: normalizedSort,
    count: sortedReleaseGroups.length,
    offset: offsetInt,
    hasMore: offsetInt + pagedReleaseGroups.length < sortedReleaseGroups.length,
    items: pagedReleaseGroups.map((releaseGroup) =>
      normalizeAlbumSearchItem(
        releaseGroup,
        albumLookup.get(releaseGroup.id),
        cachedCovers,
      ),
    ),
  };
}

export async function searchTags(
  query,
  limit = 24,
  offset = 0,
  tagScope = "recommended",
) {
  const tag = String(query || "").trim().replace(/^#/, "");
  const limitInt = parsePositiveInt(limit, 24);
  const offsetInt = Math.max(0, Number.parseInt(offset, 10) || 0);

  if (!tag) {
    return {
      scope: "tag",
      query: "",
      count: 0,
      offset: offsetInt,
      items: [],
    };
  }

  if (tagScope === "all") {
    try {
      const firstPageNumber = Math.floor(offsetInt / 100) + 1;
      const pages = [];
      let totalCount = 0;
      let pageSize = 100;
      let currentPage = firstPageNumber;
      let combined = [];

      while (combined.length < limitInt + (offsetInt % pageSize || 0)) {
        const pageData = await fetchMusicbrainzTagArtistPage(tag, currentPage);
        totalCount = pageData.totalCount;
        pageSize = pageData.pageSize || pageSize;
        if (pageData.items.length === 0) break;
        pages.push(pageData);
        combined = pages.flatMap((entry) => entry.items);
        currentPage += 1;
        if (pageData.items.length < pageSize) break;
        const absoluteLoaded =
          (firstPageNumber - 1) * pageSize + combined.length;
        if (totalCount > 0 && absoluteLoaded >= totalCount) break;
      }

      const withinPageOffset = offsetInt - (firstPageNumber - 1) * pageSize;
      const pageArtists = combined.slice(
        withinPageOffset,
        withinPageOffset + limitInt,
      );
      const cachedImages = dbOps.getImages(pageArtists.map((artist) => artist.id));
      const items = pageArtists.map((artist) => ({
        ...normalizeArtistSearchItem(artist, cachedImages),
        tags: [tag],
      }));
      primeArtistImageCache(items.slice(0, Math.min(items.length, limitInt))).catch(
        () => {},
      );

      return {
        scope: "tag",
        query: tag,
        count: totalCount || items.length,
        hasMore: totalCount > offsetInt + items.length,
        offset: offsetInt,
        items,
      };
    } catch (error) {
      console.warn(
        `MusicBrainz tag page fetch failed for "${tag}", falling back to artist search:`,
        error.message,
      );
      return searchTagsAllFallbackViaArtistSearch(tag, limitInt, offsetInt);
    }
  }

  const discoveryCache = getDiscoveryCache();
  const tagLower = tag.toLowerCase();
  const matches = (discoveryCache.recommendations || []).filter((artist) => {
    const tags = Array.isArray(artist.tags) ? artist.tags : [];
    return tags.some((entry) => String(entry).toLowerCase() === tagLower);
  });
  const items = matches
    .slice(offsetInt, offsetInt + limitInt)
    .map((artist) => normalizeTagArtistItem(artist, tag));

  return {
    scope: "tag",
    query: tag,
    count: matches.length,
    offset: offsetInt,
    items,
  };
}
