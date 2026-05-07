import { dbOps } from "../config/db-helpers.js";
import {
  fetchItunesAlbumArt,
  fetchCoverArtArchiveReleaseGroup,
  musicbrainzGetArtistNameByMbid,
  musicbrainzGetArtistReleaseGroupsPreview,
} from "./apiClients.js";
import { warmImageProxy } from "./imageProxyService.js";

const MAX_NEGATIVE_CACHE = 1000;
const MAX_PENDING_REQUESTS = 100;
const NEGATIVE_CACHE_TTL_MS = 60 * 60 * 1000;
const RELEASE_GROUP_CONCURRENCY = 4;
const negativeImageCache = new Map();
const pendingImageRequests = new Map();
const LEGACY_COVER_HOST_PATTERN =
  /https?:\/\/(?:caa\.lkly\.net|coverartarchive\.org|archive\.org|[\w-]+\.ca\.archive\.org)\//i;

const addToNegativeCache = (mbid) => {
  if (negativeImageCache.size >= MAX_NEGATIVE_CACHE) {
    const firstKey = negativeImageCache.keys().next().value;
    negativeImageCache.delete(firstKey);
  }
  negativeImageCache.set(mbid, Date.now());
};

const hasFreshNegativeCache = (mbid) => {
  const cachedAt = negativeImageCache.get(mbid);
  if (!cachedAt) return false;
  if (Date.now() - cachedAt > NEGATIVE_CACHE_TTL_MS) {
    negativeImageCache.delete(mbid);
    return false;
  }
  return true;
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
  if (
    cached?.imageUrl &&
    cached.imageUrl !== "NOT_FOUND" &&
    LEGACY_COVER_HOST_PATTERN.test(cached.imageUrl)
  ) {
    dbOps.deleteImage(cacheKey);
    return undefined;
  }
  if (cached?.imageUrl && cached.imageUrl !== "NOT_FOUND") {
    return cached.imageUrl;
  }
  if (cached?.imageUrl === "NOT_FOUND") {
    return null;
  }
  return undefined;
};

const fetchReleaseGroupCoverUrl = async (
  releaseGroupMbid,
  { artistName = "", albumTitle = "" } = {},
) => {
  const cacheKey = `rg:${releaseGroupMbid}`;
  const cached = getCachedUrl(cacheKey);
  if (cached !== undefined) {
    return { imageUrl: cached, notFound: cached === null, transientError: false };
  }
  try {
    const itunesImageUrl = await fetchItunesAlbumArt(artistName, albumTitle);
    if (itunesImageUrl) {
      const cachedImage = await warmImageProxy(itunesImageUrl);
      dbOps.setImage(cacheKey, cachedImage.localUrl);
      return {
        imageUrl: cachedImage.localUrl,
        types: ["Front"],
        notFound: false,
        transientError: false,
      };
    }

    const cover = await fetchCoverArtArchiveReleaseGroup(releaseGroupMbid);
    if (cover?.imageUrl) {
      const cachedImage = await warmImageProxy(cover.imageUrl);
      dbOps.setImage(cacheKey, cachedImage.localUrl);
      return {
        imageUrl: cachedImage.localUrl,
        types: cover.types || ["Front"],
        notFound: false,
        transientError: false,
      };
    }
    if (cover?.notFound) {
      dbOps.setImage(cacheKey, "NOT_FOUND");
      return { imageUrl: null, types: [], notFound: true, transientError: false };
    }
    if (cover?.transientError) {
      return { imageUrl: null, types: [], notFound: false, transientError: true };
    }
  } catch (e) {}
  return { imageUrl: null, types: [], notFound: false, transientError: true };
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
    cachedImage.imageUrl !== "NOT_FOUND" &&
    !LEGACY_COVER_HOST_PATTERN.test(cachedImage.imageUrl)
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

  if (
    !forceRefresh &&
    ((cachedImage && cachedImage.imageUrl === "NOT_FOUND") ||
      hasFreshNegativeCache(mbid))
  ) {
    return { url: null, images: [], notFound: true };
  }

  if (pendingImageRequests.has(mbid)) {
    return pendingImageRequests.get(mbid);
  }

  const fetchPromise = (async () => {
    try {
      const override = dbOps.getArtistOverride(mbid);
      const resolvedMbid = override?.musicbrainzId || mbid;
      const resolvedArtistName = await musicbrainzGetArtistNameByMbid(resolvedMbid).catch(
        () => null,
      );
      const rgCacheKey = `artist_rg:${resolvedMbid}`;
      const cachedRg = forceRefresh ? null : dbOps.getDeezerMbidCache(rgCacheKey);
      const releaseGroups = cachedRg
        ? cachedRg === "NOT_FOUND"
          ? []
          : [
              {
                id: cachedRg,
                title: "",
                "primary-type": "Album",
                "first-release-date": null,
              },
            ]
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

      let nextIndex = 0;
      let foundCover = null;
      let sawTransientError = false;
      const workers = Array.from(
        { length: Math.min(RELEASE_GROUP_CONCURRENCY, ordered.length) },
        async () => {
          while (nextIndex < ordered.length && !foundCover) {
            const rg = ordered[nextIndex++];
            const cover = await fetchReleaseGroupCoverUrl(rg.id, {
              artistName: resolvedArtistName || "",
              albumTitle: rg.title || "",
            });
            if (cover?.imageUrl) {
              foundCover = {
                releaseGroupId: rg.id,
                imageUrl: cover.imageUrl,
                types: cover.types || ["Front"],
              };
              return;
            }
            if (cover?.transientError) {
              sawTransientError = true;
            }
          }
        },
      );

      await Promise.all(workers);

      if (foundCover) {
        negativeImageCache.delete(mbid);
        dbOps.setImage(mbid, foundCover.imageUrl);
        if (!cachedRg || forceRefresh) {
          dbOps.setDeezerMbidCache(rgCacheKey, foundCover.releaseGroupId);
        }
        return {
          url: foundCover.imageUrl,
          images: [
            {
              image: foundCover.imageUrl,
              front: true,
              types: foundCover.types,
            },
          ],
        };
      }

      if (sawTransientError) {
        return { url: null, images: [], transientError: true };
      }

      if (!cachedRg || forceRefresh) {
        dbOps.setDeezerMbidCache(rgCacheKey, "NOT_FOUND");
      }
    } catch (e) {
      console.warn(`Failed to fetch image for ${mbid}:`, e.message);
      return { url: null, images: [], transientError: true };
    }

    addToNegativeCache(mbid);
    dbOps.setImage(mbid, "NOT_FOUND");

    return { url: null, images: [], notFound: true };
  })();

  addToPendingRequests(mbid, fetchPromise);
  try {
    return await fetchPromise;
  } finally {
    pendingImageRequests.delete(mbid);
  }
};
