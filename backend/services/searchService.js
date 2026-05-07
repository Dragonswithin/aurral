import NodeCache from "node-cache";
import axios from "axios";
import { dbOps } from "../config/db-helpers.js";
import { musicbrainzRequest } from "./apiClients.js";
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
const albumLibraryLookupCache = new NodeCache({
  stdTTL: 60,
  checkperiod: 60,
  maxKeys: 10,
});
const MUSICBRAINZ_TAG_PAGE_URL = "https://musicbrainz.org";

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
  const normalizedTag = encodeURIComponent(String(tag || "").trim());
  const url = `${MUSICBRAINZ_TAG_PAGE_URL}/tag/${normalizedTag}/artist?page=${page}`;
  const response = await axios.get(url, {
    timeout: 5000,
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

  return {
    totalCount,
    items,
    pageSize: items.length,
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
) {
  const limitInt = parsePositiveInt(limit, 24);
  const offsetInt = Math.max(0, Number.parseInt(offset, 10) || 0);
  const selectedReleaseTypes = normalizeAlbumReleaseTypesFilter(releaseTypes);
  const useDirectPrimaryTypeSearch =
    canUseDirectPrimaryTypeSearch(selectedReleaseTypes);
  const shouldFilterByReleaseType =
    !useDirectPrimaryTypeSearch &&
    selectedReleaseTypes.length > 0 &&
    selectedReleaseTypes.length < ALL_RELEASE_TYPES.size;
  const musicbrainzQuery = buildAlbumSearchQuery(query, selectedReleaseTypes);
  const MAX_SEARCH_PAGES = 6;
  let pagesFetched = 0;
  const rawPageSize = shouldFilterByReleaseType
    ? Math.max(limitInt, 50)
    : limitInt;

  let rawOffset = shouldFilterByReleaseType ? 0 : offsetInt;
  let matchedCount = 0;
  let rawCount = 0;
  let hasMore = false;
  const filteredReleaseGroups = [];

  while (
    filteredReleaseGroups.length < limitInt ||
    (shouldFilterByReleaseType && !hasMore)
  ) {
    if (pagesFetched >= MAX_SEARCH_PAGES) {
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

    if (useDirectPrimaryTypeSearch) {
      filteredReleaseGroups.push(
        ...validReleaseGroups.slice(0, Math.max(0, limitInt - filteredReleaseGroups.length)),
      );
      hasMore = rawCount > offsetInt + filteredReleaseGroups.length;
      break;
    }

    for (const releaseGroup of validReleaseGroups) {
      if (
        shouldFilterByReleaseType &&
        !matchesAlbumReleaseTypeFilter(releaseGroup, selectedReleaseTypes)
      ) {
        continue;
      }
      if (matchedCount < offsetInt) {
        matchedCount += 1;
        continue;
      }
      if (filteredReleaseGroups.length < limitInt) {
        filteredReleaseGroups.push(releaseGroup);
        continue;
      }
      hasMore = true;
      break;
    }

    if (hasMore) {
      break;
    }
    if (validReleaseGroups.length === 0) {
      break;
    }
    rawOffset += releaseGroups.length;
    if (rawCount > 0 && rawOffset >= rawCount) {
      break;
    }
    if (!shouldFilterByReleaseType) {
      break;
    }
  }

  const albumLookup = await getAlbumLibraryLookup(
    filteredReleaseGroups.map((releaseGroup) => releaseGroup.id),
  );
  const cachedCovers = dbOps.getImages(
    filteredReleaseGroups.map((releaseGroup) => `rg:${releaseGroup.id}`),
  );

  return {
    scope: "album",
    query,
    count: shouldFilterByReleaseType
      ? offsetInt + filteredReleaseGroups.length + (hasMore ? 1 : 0)
      : rawCount || filteredReleaseGroups.length,
    offset: offsetInt,
    hasMore:
      shouldFilterByReleaseType
        ? hasMore
        : (rawCount || filteredReleaseGroups.length) >
          offsetInt + filteredReleaseGroups.length,
    items: filteredReleaseGroups.map((releaseGroup) =>
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
    const pageArtists = combined.slice(withinPageOffset, withinPageOffset + limitInt);
    const cachedImages = dbOps.getImages(pageArtists.map((artist) => artist.id));
    const items = pageArtists.map((artist) => ({
      ...normalizeArtistSearchItem(artist, cachedImages),
      tags: [tag],
    }));
    primeArtistImageCache(items.slice(0, Math.min(items.length, limitInt))).catch(() => {});

    return {
      scope: "tag",
      query: tag,
      count: totalCount || items.length,
      hasMore: totalCount > offsetInt + items.length,
      offset: offsetInt,
      items,
    };
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
