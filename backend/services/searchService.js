import NodeCache from "node-cache";
import { getDiscoveryCache } from "./discoveryService.js";
import { getLastfmApiKey, lastfmRequest } from "./apiClients.js";
import { buildImageProxyUrl } from "./imageProxyService.js";
import { lidarrClient } from "./lidarrClient.js";
import {
  searchAlbums as providerSearchAlbums,
  searchArtists as providerSearchArtists,
} from "./metadataProvider.js";
import {
  DISCOVERY_PROVIDER_LISTENBRAINZ_FALLBACK,
  searchFallbackGenreArtists,
} from "./listenbrainzDiscoveryFallback.js";

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

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function normalizeSearchText(value) {
  return String(value || "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizePercentOfTracks(value) {
  const raw = Number(value);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  if (raw > 1 && raw <= 100) return Math.round(raw);
  if (raw <= 1) return Math.round(raw * 100);
  return Math.min(100, Math.round(raw / 10));
}

async function getAlbumLibraryLookup(albumMbids) {
  const lookup = new Map();
  if (!lidarrClient.isConfigured() || albumMbids.length === 0) {
    return lookup;
  }

  try {
    const lidarrAlbums = albumLibraryLookupCache.get("lidarrAlbums");
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

export function normalizeAlbumReleaseTypesFilter(releaseTypes) {
  const values = Array.isArray(releaseTypes)
    ? releaseTypes
    : String(releaseTypes || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
  return [...new Set(values.filter((value) => ALL_RELEASE_TYPES.has(value)))];
}

export function normalizeAlbumSearchSort(value) {
  const normalized = String(value || "").trim();
  return ["relevance", "dateDesc", "artistAsc", "titleAsc"].includes(normalized)
    ? normalized
    : "relevance";
}

function normalizeArtistItem(item) {
  return {
    type: "artist",
    id: item.id,
    name: item.name,
    sortName: item.sortName || item.name,
    image: item.images?.[0]?.url || null,
    imageUrl: item.images?.[0]?.url || null,
    artistType: item.type || null,
    country: null,
    area: null,
    begin: null,
    end: null,
    disambiguation: item.disambiguation || null,
    tags: Array.isArray(item.genres) ? item.genres : [],
    genres: Array.isArray(item.genres) ? item.genres : [],
    inLibrary: false,
    score: item.score || 0,
  };
}

export function normalizeArtistSearchItem(item, imageCache = {}) {
  const normalized = normalizeArtistItem({
    id: item?.id,
    name: item?.name,
    sortName: item?.sortName || item?.["sort-name"] || item?.name,
    type: item?.type || null,
    disambiguation: item?.disambiguation || null,
    genres: item?.genres || item?.tags || [],
    images: imageCache?.[item?.id]?.imageUrl
      ? [{ url: imageCache[item.id].imageUrl }]
      : item?.imageUrl || item?.image
        ? [{ url: item.imageUrl || item.image }]
        : [],
    score: item?.score || 0,
  });
  return normalized;
}

function normalizeAlbumItem(item, lookup = null) {
  return {
    type: "album",
    id: item.id,
    title: item.title || "Untitled Release",
    artistName: item.artistName || "Unknown Artist",
    artistMbid: item.artistId || null,
    releaseDate: item.releaseDate || null,
    primaryType: item.type || null,
    secondaryTypes: Array.isArray(item.secondaryTypes) ? item.secondaryTypes : [],
    coverUrl: item.coverUrl || null,
    inLibrary: !!lookup,
    libraryAlbumId: lookup?.libraryAlbumId || null,
    libraryArtistId: lookup?.libraryArtistId || null,
    status: lookup?.status || "missing",
    score: item.score || 0,
  };
}

export function normalizeAlbumSearchItem(item, lookup = {}) {
  const artistCredit = Array.isArray(item?.["artist-credit"])
    ? item["artist-credit"]
    : [];
  const primaryCredit = artistCredit[0] || {};
  const artist = primaryCredit.artist || {};
  const normalized = normalizeAlbumItem(
    {
      id: item?.id,
      title: item?.title,
      artistName: primaryCredit.name || artist.name || item?.artistName,
      artistId: artist.id || item?.artistMbid || item?.artistId || null,
      type: item?.type || item?.["primary-type"] || null,
      secondaryTypes:
        item?.secondaryTypes || item?.["secondary-types"] || [],
      releaseDate: item?.releaseDate || item?.["first-release-date"] || null,
      coverUrl: item?.coverUrl || null,
      score: item?.score || 0,
    },
    lookup?.inLibrary || lookup?.libraryAlbumId || lookup?.libraryArtistId
      ? lookup
      : null,
  );
  delete normalized.score;
  return normalized;
}

export function matchesAlbumReleaseTypeFilter(item, selectedReleaseTypes = []) {
  const selected = normalizeAlbumReleaseTypesFilter(selectedReleaseTypes);
  if (selected.length === 0) return true;

  const primaryType = String(item?.primaryType || item?.["primary-type"] || "").trim();
  const secondaryTypes = Array.isArray(
    item?.secondaryTypes || item?.["secondary-types"],
  )
    ? item.secondaryTypes || item["secondary-types"]
    : [];

  const primaryMatches = selected.filter((value) => PRIMARY_RELEASE_TYPES.has(value));
  const secondaryMatches = selected.filter((value) =>
    SECONDARY_RELEASE_TYPES.has(value),
  );

  if (primaryMatches.length > 0 && !primaryMatches.includes(primaryType)) {
    return false;
  }

  if (!secondaryMatches.every((value) => secondaryTypes.includes(value))) {
    return false;
  }

  if (secondaryMatches.length > 0 && secondaryTypes.length !== secondaryMatches.length) {
    return false;
  }

  return true;
}

export async function searchArtists(query, limit = 24, offset = 0) {
  const limitInt = parsePositiveInt(limit, 24);
  const offsetInt = Math.max(0, Number.parseInt(offset, 10) || 0);
  const result = await providerSearchArtists(String(query || "").trim(), {
    limit: limitInt,
    offset: offsetInt,
  });
  return {
    scope: "artist",
    query,
    count: result.count,
    offset: result.offset,
    items: result.items.map(normalizeArtistItem),
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
  const normalizedSort = normalizeAlbumSearchSort(sort);
  const selectedReleaseTypes = normalizeAlbumReleaseTypesFilter(releaseTypes);
  const result = await providerSearchAlbums(String(query || "").trim(), {
    limit: limitInt,
    offset: offsetInt,
    releaseTypes: selectedReleaseTypes,
    sort: normalizedSort,
  });
  const albumLookup = await getAlbumLibraryLookup(result.items.map((item) => item.id));
  return {
    scope: "album",
    query,
    sort: normalizedSort,
    count: result.count,
    offset: result.offset,
    hasMore: result.offset + result.items.length < result.count,
    items: result.items.map((item) =>
      normalizeAlbumItem(item, albumLookup.get(item.id)),
    ),
  };
}

function normalizeTagArtistItem(artist, tag) {
  return {
    ...artist,
    tags: [tag],
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
    if (getLastfmApiKey()) {
      const page = Math.floor(offsetInt / limitInt) + 1;
      const data = await lastfmRequest("tag.getTopArtists", {
        tag,
        limit: limitInt,
        page,
      });
      const artists = Array.isArray(data?.topartists?.artist)
        ? data.topartists.artist
        : data?.topartists?.artist
          ? [data.topartists.artist]
          : [];
      const items = artists
        .map((artist) => {
          let imageUrl = null;
          if (Array.isArray(artist?.image)) {
            const img =
              artist.image.find((entry) => entry.size === "extralarge") ||
              artist.image.find((entry) => entry.size === "large") ||
              artist.image.slice(-1)[0];
            if (
              img?.["#text"] &&
              !String(img["#text"]).includes("2a96cbd8b46e442fc41c2b86b821562f")
            ) {
              imageUrl = img["#text"];
            }
          }
          return normalizeTagArtistItem(
            {
              type: "artist",
              id: artist?.mbid || null,
              name: artist?.name || "Unknown Artist",
              sortName: artist?.name || "Unknown Artist",
              image: buildImageProxyUrl(imageUrl) || imageUrl,
              imageUrl: buildImageProxyUrl(imageUrl) || imageUrl,
              artistType: null,
              country: null,
              area: null,
              begin: null,
              end: null,
              disambiguation: null,
              tags: [tag],
              genres: [tag],
              inLibrary: false,
              score: 0,
            },
            tag,
          );
        })
        .filter((artist) => artist.id);

      return {
        scope: "tag",
        query: tag,
        count:
          Number.parseInt(data?.topartists?.["@attr"]?.total, 10) || items.length,
        offset: offsetInt,
        items,
      };
    }

    const discoveryCacheData = getDiscoveryCache();
    const fallbackResult = await searchFallbackGenreArtists({
      tag,
      limit: limitInt,
      offset: offsetInt,
      precomputedGenrePools:
        discoveryCacheData?.fallbackGenrePools &&
        Object.keys(discoveryCacheData.fallbackGenrePools).length > 0
          ? discoveryCacheData.fallbackGenrePools
          : null,
    });
    if (fallbackResult) {
      return {
        scope: "tag",
        query: tag,
        count: fallbackResult.total,
        offset: offsetInt,
        provider: DISCOVERY_PROVIDER_LISTENBRAINZ_FALLBACK,
        fallbackLimited: true,
        items: fallbackResult.artists.map((artist) =>
          normalizeTagArtistItem(
            {
              type: "artist",
              id: artist.id || artist.mbid || null,
              name: artist.name || "Unknown Artist",
              sortName: artist.sortName || artist.name || "Unknown Artist",
              image: artist.image || artist.imageUrl || null,
              imageUrl: artist.image || artist.imageUrl || null,
              artistType: null,
              country: null,
              area: null,
              begin: null,
              end: null,
              disambiguation: null,
              tags: artist.tags || [tag],
              genres: artist.genres || [tag],
              inLibrary: false,
              score: 0,
            },
            tag,
          ),
        ),
      };
    }

    const discoveryCache = discoveryCacheData;
    const tagLower = normalizeSearchText(tag);
    const pool = [
      ...(Array.isArray(discoveryCache.recommendations)
        ? discoveryCache.recommendations
        : []),
      ...(Array.isArray(discoveryCache.globalTop) ? discoveryCache.globalTop : []),
      ...(Array.isArray(discoveryCache.basedOn) ? discoveryCache.basedOn : []),
      ...(Array.isArray(discoveryCache.fallbackGenres)
        ? discoveryCache.fallbackGenres.flatMap((section) =>
            Array.isArray(section?.artists) ? section.artists : [],
          )
        : []),
    ];
    const seen = new Set();
    const matches = pool.filter((artist) => {
      const artistId = String(artist?.id || artist?.mbid || "").trim().toLowerCase();
      const artistName = String(artist?.name || "").trim().toLowerCase();
      const key = artistId || artistName;
      if (!key || seen.has(key)) return false;
      const tags = Array.isArray(artist.tags) ? artist.tags : [];
      const genres = Array.isArray(artist.genres) ? artist.genres : [];
      const matched = [...tags, ...genres].some(
        (entry) => normalizeSearchText(entry) === tagLower,
      );
      if (!matched) return false;
      seen.add(key);
      return true;
    });

    return {
      scope: "tag",
      query: tag,
      count: matches.length,
      offset: offsetInt,
      provider: DISCOVERY_PROVIDER_LISTENBRAINZ_FALLBACK,
      fallbackLimited: true,
      message: "Tag search is limited without Last.fm",
      items: matches
        .slice(offsetInt, offsetInt + limitInt)
        .map((artist) => normalizeTagArtistItem(artist, tag)),
    };
  }

  const discoveryCache = getDiscoveryCache();
  const tagLower = normalizeSearchText(tag);
  const matches = (discoveryCache.recommendations || []).filter((artist) => {
    const tags = Array.isArray(artist.tags) ? artist.tags : [];
    const genres = Array.isArray(artist.genres) ? artist.genres : [];
    return [...tags, ...genres].some(
      (entry) => normalizeSearchText(entry) === tagLower,
    );
  });

  return {
    scope: "tag",
    query: tag,
    count: matches.length,
    offset: offsetInt,
    items: matches
      .slice(offsetInt, offsetInt + limitInt)
      .map((artist) => normalizeTagArtistItem(artist, tag)),
  };
}
