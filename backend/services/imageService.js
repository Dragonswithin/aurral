import { dbOps } from "../config/db-helpers.js";
import {
  fetchCoverArtArchiveReleaseGroup,
  musicbrainzGetArtistReleaseGroupsPreview,
} from "./apiClients.js";

const MAX_NEGATIVE_CACHE = 1000;
const MAX_PENDING_REQUESTS = 100;
const negativeImageCache = new Set();
const pendingImageRequests = new Map();

const addToNegativeCache = (mbid) => {
  if (negativeImageCache.size >= MAX_NEGATIVE_CACHE) {
    const firstKey = negativeImageCache.values().next().value;
    negativeImageCache.delete(firstKey);
  }
  negativeImageCache.add(mbid);
};

const addToPendingRequests = (mbid, promise) => {
  if (pendingImageRequests.size >= MAX_PENDING_REQUESTS) {
    const firstKey = pendingImageRequests.keys().next().value;
    pendingImageRequests.delete(firstKey);
  }
  pendingImageRequests.set(mbid, promise);
};

const getCachedUrl = (cacheKey) => {
  const cached = dbOps.getImage(cacheKey);
  if (cached?.imageUrl && cached.imageUrl !== "NOT_FOUND") {
    return cached.imageUrl;
  }
  if (cached?.imageUrl === "NOT_FOUND") {
    return null;
  }
  return undefined;
};

const fetchReleaseGroupCoverUrl = async (releaseGroupMbid) => {
  const cacheKey = `rg:${releaseGroupMbid}`;
  const cached = getCachedUrl(cacheKey);
  if (cached !== undefined) return cached;
  try {
    const cover = await fetchCoverArtArchiveReleaseGroup(releaseGroupMbid);
    if (cover?.imageUrl) {
      dbOps.setImage(cacheKey, cover.imageUrl);
      return cover.imageUrl;
    }
  } catch (e) {}
  dbOps.setImage(cacheKey, "NOT_FOUND");
  return null;
};

const typeRank = (primaryType) => {
  if (primaryType === "Album") return 0;
  if (primaryType === "EP") return 1;
  if (primaryType === "Single") return 2;
  return 3;
};

export const getArtistImage = async (mbid, forceRefresh = false) => {
  if (!mbid) return { url: null, images: [] };

  const cachedImage = dbOps.getImage(mbid);
  if (
    !forceRefresh &&
    cachedImage &&
    cachedImage.imageUrl &&
    cachedImage.imageUrl !== "NOT_FOUND"
  ) {
    return {
      url: cachedImage.imageUrl,
      images: [
        {
          image: cachedImage.imageUrl,
          front: true,
          types: ["Front"],
        },
      ],
    };
  }

  if (!forceRefresh && cachedImage && cachedImage.imageUrl === "NOT_FOUND") {
    dbOps.deleteImage(mbid);
    negativeImageCache.delete(mbid);
  }

  if (!forceRefresh && negativeImageCache.has(mbid)) {
    return { url: null, images: [] };
  }

  if (pendingImageRequests.has(mbid)) {
    return pendingImageRequests.get(mbid);
  }

  const fetchPromise = (async () => {
    try {
      const override = dbOps.getArtistOverride(mbid);
      const resolvedMbid = override?.musicbrainzId || mbid;
      const rgCacheKey = `artist_rg:${resolvedMbid}`;
      const cachedRg = forceRefresh ? null : dbOps.getDeezerMbidCache(rgCacheKey);
      const releaseGroups = cachedRg
        ? cachedRg === "NOT_FOUND"
          ? []
          : [{ id: cachedRg, "primary-type": "Album", "first-release-date": null }]
        : await musicbrainzGetArtistReleaseGroupsPreview(resolvedMbid, 30);

      const ordered = releaseGroups
        .filter((rg) => rg?.id)
        .sort((a, b) => {
          const rankDiff = typeRank(a["primary-type"]) - typeRank(b["primary-type"]);
          if (rankDiff !== 0) return rankDiff;
          const dateA = a["first-release-date"] || "";
          const dateB = b["first-release-date"] || "";
          return dateB.localeCompare(dateA);
        })
        .slice(0, 25);

      for (const rg of ordered) {
        const coverUrl = await fetchReleaseGroupCoverUrl(rg.id);
        if (coverUrl) {
          dbOps.setImage(mbid, coverUrl);
          if (!cachedRg || forceRefresh) {
            dbOps.setDeezerMbidCache(rgCacheKey, rg.id);
          }
          return {
            url: coverUrl,
            images: [{ image: coverUrl, front: true, types: ["Front"] }],
          };
        }
      }

      if (!cachedRg || forceRefresh) {
        dbOps.setDeezerMbidCache(rgCacheKey, "NOT_FOUND");
      }
    } catch (e) {
      console.warn(`Failed to fetch image for ${mbid}:`, e.message);
    }

    addToNegativeCache(mbid);
    dbOps.setImage(mbid, "NOT_FOUND");

    return { url: null, images: [] };
  })();

  addToPendingRequests(mbid, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    pendingImageRequests.delete(mbid);
  }
};
