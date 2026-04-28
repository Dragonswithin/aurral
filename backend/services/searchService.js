import NodeCache from "node-cache";
import { dbOps } from "../config/db-helpers.js";
import {
  getLastfmApiKey,
  lastfmRequest,
  musicbrainzRequest,
} from "./apiClients.js";
import { getDiscoveryCache } from "./discoveryService.js";
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

function parsePositiveInt(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
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

export function normalizeArtistSearchItem(artist, cachedImages = {}) {
  const imageUrl = normalizeArtistImage(cachedImages[artist.id]);
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

export function normalizeAlbumSearchItem(releaseGroup, lookup = null) {
  const artistCredit = normalizeArtistCredit(releaseGroup["artist-credit"]);
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
    coverUrl: null,
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

function normalizeTagArtistItem(artist, tag) {
  let imageUrl = artist.image || artist.imageUrl || null;
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

  return {
    type: "artist",
    id: artist.id || artist.mbid,
    name: artist.name,
    sortName: artist.sortName || artist.name,
    image: imageUrl,
    imageUrl,
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
      lidarrAlbums = await lidarrClient.request("/album");
      albumLibraryLookupCache.set("lidarrAlbums", lidarrAlbums);
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
  const shouldFilterByReleaseType =
    selectedReleaseTypes.length > 0 &&
    selectedReleaseTypes.length < ALL_RELEASE_TYPES.size;
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
    const mbData = await musicbrainzRequest("/release-group", {
      query,
      limit: rawPageSize,
      offset: rawOffset,
    });
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
      normalizeAlbumSearchItem(releaseGroup, albumLookup.get(releaseGroup.id)),
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

  if (tagScope === "all" && getLastfmApiKey()) {
    const page = Math.floor(offsetInt / limitInt) + 1;
    const data = await lastfmRequest("tag.getTopArtists", {
      tag,
      limit: limitInt,
      page,
    });
    const rawArtists = Array.isArray(data?.topartists?.artist)
      ? data.topartists.artist
      : data?.topartists?.artist
        ? [data.topartists.artist]
        : [];
    const items = rawArtists
      .map((artist) => normalizeTagArtistItem(artist, tag))
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
