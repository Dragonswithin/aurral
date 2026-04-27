import { dbOps } from "../config/db-helpers.js";
import { GENRE_KEYWORDS } from "../config/constants.js";
import {
  lastfmRequest,
  listenbrainzRequest,
  getLastfmApiKey,
  deezerSearchArtist,
  musicbrainzGetCachedArtistMbidByName,
} from "./apiClients.js";
import { websocketService } from "./websocketService.js";
import {libraryManager} from "./libraryManager.js";
import {
  getListenHistoryCacheNamespace,
  getListenHistoryProfile,
} from "./listeningHistory.js";

const LASTFM_PERIODS = [
  "none",
  "7day",
  "1month",
  "3month",
  "6month",
  "12month",
  "overall",
];
const LISTENBRAINZ_RANGE_BY_PERIOD = {
  "7day": "week",
  "1month": "month",
  "3month": "quarter",
  "6month": "half_yearly",
  "12month": "year",
  overall: "all_time",
};
const getLastfmDiscoveryPeriod = () => {
  const settings = dbOps.getSettings();
  const p = settings.integrations?.lastfm?.discoveryPeriod;
  return p && LASTFM_PERIODS.includes(p) ? p : "1month";
};

const getListenbrainzRange = (discoveryPeriod) => {
  if (discoveryPeriod === "none") return null;
  return LISTENBRAINZ_RANGE_BY_PERIOD[discoveryPeriod] || "month";
};

const clampInt = (value, fallback, min, max) => {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
};
const MBID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const normalizeTextList = (value) => {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  const out = [];
  for (const entry of value) {
    const normalized = String(entry || "")
      .trim()
      .toLowerCase();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }
  return out;
};

const normalizeBlocklist = (value) => {
  const source = value && typeof value === "object" ? value : {};
  const rawArtists = Array.isArray(source.artists) ? source.artists : [];
  const seenArtistKeys = new Set();
  const artists = [];
  for (const entry of rawArtists) {
    if (entry == null) continue;
    let mbid = null;
    let name = null;
    if (typeof entry === "string") {
      const normalized = entry.trim();
      if (!normalized) continue;
      if (MBID_REGEX.test(normalized)) {
        mbid = normalized.toLowerCase();
      } else {
        name = normalized;
      }
    } else if (typeof entry === "object") {
      const rawMbid = String(
        entry.mbid || entry.artistId || entry.id || "",
      ).trim();
      if (rawMbid && MBID_REGEX.test(rawMbid)) {
        mbid = rawMbid.toLowerCase();
      }
      const rawName = String(entry.name || entry.artistName || "").trim();
      if (rawName) {
        name = rawName;
      }
    }
    if (!mbid && !name) continue;
    const key = mbid
      ? `mbid:${mbid}`
      : `name:${String(name).trim().toLowerCase()}`;
    if (seenArtistKeys.has(key)) continue;
    seenArtistKeys.add(key);
    artists.push({ mbid, name: name || null });
  }
  return {
    artists,
    tags: normalizeTextList(source.tags),
  };
};

const getStoredBlocklist = () => {
  const settings = dbOps.getSettings();
  return normalizeBlocklist(settings.blocklist);
};

const isArtistBlocked = (artist, artistBlockSet) => {
  if (!artist || !artistBlockSet) return false;
  const mbids = [artist?.id, artist?.mbid, artist?.foreignArtistId]
    .map((value) =>
      String(value || "")
        .trim()
        .toLowerCase(),
    )
    .filter((value) => MBID_REGEX.test(value));
  if (mbids.some((mbid) => artistBlockSet.mbids.has(mbid))) return true;
  const names = [artist?.name, artist?.artistName]
    .map((value) =>
      String(value || "")
        .trim()
        .toLowerCase(),
    )
    .filter(Boolean);
  return names.some((name) => artistBlockSet.names.has(name));
};

const hasBlockedTag = (artist, tagBlockSet) => {
  if (!artist || !tagBlockSet || tagBlockSet.size === 0) return false;
  const tags = Array.isArray(artist.tags) ? artist.tags : [];
  return tags.some((tag) =>
    tagBlockSet.has(
      String(tag || "")
        .trim()
        .toLowerCase(),
    ),
  );
};

const applyBlocklistToArtistCollection = (artists, blocklist) => {
  const list = Array.isArray(artists) ? artists : [];
  if (list.length === 0) return [];
  const artistEntries = Array.isArray(blocklist.artists)
    ? blocklist.artists
    : [];
  const artistBlockSet = {
    mbids: new Set(
      artistEntries
        .map((entry) =>
          String(entry?.mbid || "")
            .trim()
            .toLowerCase(),
        )
        .filter((value) => MBID_REGEX.test(value)),
    ),
    names: new Set(
      artistEntries
        .map((entry) =>
          String(entry?.name || "")
            .trim()
            .toLowerCase(),
        )
        .filter(Boolean),
    ),
  };
  const tagBlockSet = new Set(blocklist.tags || []);
  return list.filter(
    (artist) =>
      !isArtistBlocked(artist, artistBlockSet) &&
      !hasBlockedTag(artist, tagBlockSet),
  );
};

const applyBlocklistToTagList = (tags, blocklist) => {
  const list = Array.isArray(tags) ? tags : [];
  if (list.length === 0) return [];
  const blockedTags = new Set(blocklist.tags || []);
  if (blockedTags.size === 0) return list;
  return list.filter(
    (tag) =>
      !blockedTags.has(
        String(tag || "")
          .trim()
          .toLowerCase(),
      ),
  );
};

export const getDiscoveryAutoRefreshHours = () => {
  const settings = dbOps.getSettings();
  return clampInt(
    settings.integrations?.lastfm?.discoveryAutoRefreshHours,
    168,
    1,
    168,
  );
};

export const getDiscoveryRecommendationsPerRefresh = () => {
  const settings = dbOps.getSettings();
  return clampInt(
    settings.integrations?.lastfm?.discoveryRecommendationsPerRefresh,
    100,
    10,
    500,
  );
};

const createLastfmHealth = () => ({
  success: 0,
  failure: 0,
});

const getLastfmFailureRatio = (health) => {
  const total = health.success + health.failure;
  if (total === 0) return 0;
  return health.failure / total;
};

const recordLastfmResult = (health, payload) => {
  if (payload && !payload.error) {
    health.success += 1;
  } else {
    health.failure += 1;
  }
};

const emitDiscoveryProgress = (
  phase,
  progressMessage,
  progress,
  extra = {},
) => {
  websocketService.emitDiscoveryUpdate({
    phase,
    progress,
    progressMessage,
    isUpdating: true,
    configured: true,
    ...extra,
  });
};

const EMPTY_CACHE = {
  recommendations: [],
  globalTop: [],
  basedOn: [],
  topTags: [],
  topGenres: [],
  lastUpdated: null,
  isUpdating: false,
};

let discoveryCache = { ...EMPTY_CACHE };

const dbData = dbOps.getDiscoveryCache();
if (
  dbData.recommendations?.length > 0 ||
  dbData.globalTop?.length > 0 ||
  dbData.topGenres?.length > 0
) {
  discoveryCache = {
    recommendations: dbData.recommendations || [],
    globalTop: dbData.globalTop || [],
    basedOn: dbData.basedOn || [],
    topTags: dbData.topTags || [],
    topGenres: dbData.topGenres || [],
    lastUpdated: dbData.lastUpdated || null,
    isUpdating: false,
  };
}

export const getDiscoveryCache = (lastfmUsername = null) => {
  if (lastfmUsername) {
    const userDbData = dbOps.getDiscoveryCache(lastfmUsername);
    const hasUserData =
      userDbData.recommendations?.length > 0 ||
      userDbData.basedOn?.length > 0;
    if (hasUserData) {
      return {
        recommendations: userDbData.recommendations || [],
        globalTop: discoveryCache.globalTop || [],
        basedOn: userDbData.basedOn || [],
        topTags: userDbData.topTags?.length > 0 ? userDbData.topTags : discoveryCache.topTags || [],
        topGenres: userDbData.topGenres?.length > 0 ? userDbData.topGenres : discoveryCache.topGenres || [],
        lastUpdated: userDbData.lastUpdated || discoveryCache.lastUpdated || null,
        isUpdating: discoveryCache.isUpdating,
      };
    }
  }

  const dbData = dbOps.getDiscoveryCache();
  if (
    (dbData.recommendations?.length > 0 &&
      (!discoveryCache.recommendations ||
        discoveryCache.recommendations.length === 0)) ||
    (dbData.globalTop?.length > 0 &&
      (!discoveryCache.globalTop || discoveryCache.globalTop.length === 0)) ||
    (dbData.topGenres?.length > 0 &&
      (!discoveryCache.topGenres || discoveryCache.topGenres.length === 0))
  ) {
    Object.assign(discoveryCache, {
      recommendations:
        dbData.recommendations || discoveryCache.recommendations || [],
      globalTop: dbData.globalTop || discoveryCache.globalTop || [],
      basedOn: dbData.basedOn || discoveryCache.basedOn || [],
      topTags: dbData.topTags || discoveryCache.topTags || [],
      topGenres: dbData.topGenres || discoveryCache.topGenres || [],
      lastUpdated: dbData.lastUpdated || discoveryCache.lastUpdated || null,
    });
  }
  return discoveryCache;
};

const fetchListenHistoryArtists = async (
  listenHistoryProfile,
  discoveryPeriod,
  lastfmHealth,
) => {
  const profile = getListenHistoryProfile(listenHistoryProfile);
  if (!profile.listenHistoryUsername || discoveryPeriod === "none") {
    return [];
  }

  if (profile.listenHistoryProvider === "listenbrainz") {
    const data = await listenbrainzRequest(
      `/1/stats/user/${encodeURIComponent(profile.listenHistoryUsername)}/artists`,
      {
        count: 50,
        range: getListenbrainzRange(discoveryPeriod),
      },
    );
    const artists = Array.isArray(data?.payload?.artists)
      ? data.payload.artists
      : [];
    return artists
      .map((artist) => {
        const mbid = Array.isArray(artist.artist_mbids)
          ? artist.artist_mbids.find(Boolean)
          : artist.artist_mbid || null;
        const resolvedMbid =
          mbid || musicbrainzGetCachedArtistMbidByName(artist.artist_name);
        if (!resolvedMbid) return null;
        return {
          mbid: resolvedMbid,
          artistName: artist.artist_name,
          playcount: parseInt(artist.listen_count || 0, 10) || 0,
        };
      })
      .filter(Boolean);
  }

  const userTopArtists = await lastfmRequest("user.getTopArtists", {
    user: profile.listenHistoryUsername,
    limit: 50,
    period: discoveryPeriod,
  });
  recordLastfmResult(lastfmHealth, userTopArtists);

  if (!userTopArtists?.topartists?.artist) {
    return [];
  }

  const artists = Array.isArray(userTopArtists.topartists.artist)
    ? userTopArtists.topartists.artist
    : [userTopArtists.topartists.artist];

  return artists
    .map((artist) => {
      if (!artist.mbid) return null;
      return {
        mbid: artist.mbid,
        artistName: artist.name,
        playcount: parseInt(artist.playcount || 0, 10) || 0,
      };
    })
    .filter(Boolean);
};

export const updateDiscoveryCache = async () => {
  if (discoveryCache.isUpdating) {
    console.log("Discovery update already in progress, skipping...");
    return;
  }
  discoveryCache.isUpdating = true;
  console.log("Starting background update of discovery recommendations...");
  emitDiscoveryProgress("starting", "Preparing discovery refresh", 5);

  try {
    const { libraryManager } = await import("./libraryManager.js");
    emitDiscoveryProgress("loading_sources", "Loading library artists", 12);
    const [recentLibraryArtists, allLibraryArtistsRaw] = await Promise.all([
      libraryManager.getRecentArtists(25),
      libraryManager.getAllArtists(),
    ]);
    const allLibraryArtists = Array.isArray(allLibraryArtistsRaw)
      ? allLibraryArtistsRaw
      : [];
    const libraryArtists =
      recentLibraryArtists.length > 0
        ? recentLibraryArtists
        : allLibraryArtists.slice(0, 25);
    console.log(`Found ${allLibraryArtists.length} artists in library.`);

    const existingArtistIds = new Set(
      allLibraryArtists
        .map((a) => a.mbid || a.foreignArtistId || a.id)
        .filter(Boolean),
    );

    const hasLastfmKey = !!getLastfmApiKey();
    const lastfmHealth = createLastfmHealth();

    if (allLibraryArtists.length === 0 && !hasLastfmKey) {
      console.log(
        "No artists in library and no Last.fm key. Skipping discovery and clearing cache.",
      );
      discoveryCache.recommendations = [];
      discoveryCache.globalTop = [];
      discoveryCache.basedOn = [];
      discoveryCache.topTags = [];
      discoveryCache.topGenres = [];
      discoveryCache.lastUpdated = null;
      discoveryCache.isUpdating = false;

      dbOps.updateDiscoveryCache({
        recommendations: [],
        globalTop: [],
        basedOn: [],
        topTags: [],
        topGenres: [],
        lastUpdated: null,
      });
      websocketService.emitDiscoveryUpdate({
        recommendations: [],
        globalTop: [],
        basedOn: [],
        topTags: [],
        topGenres: [],
        lastUpdated: null,
        isUpdating: false,
        configured: false,
        phase: "completed",
        progress: 100,
        progressMessage: "Discovery refresh completed",
      });
      return;
    }

    emitDiscoveryProgress(
      "collecting_seeds",
      "Collecting recommendation seed artists",
      20,
    );

    const allSourceArtists = libraryArtists.map((a) => ({
      mbid: a.mbid,
      artistName: a.artistName,
      source: "library",
    }));

    const uniqueArtists = [];
    const seenMbids = new Set();
    for (const artist of allSourceArtists) {
      if (artist.mbid && !seenMbids.has(artist.mbid)) {
        seenMbids.add(artist.mbid);
        uniqueArtists.push(artist);
      }
    }

    const tagCounts = new Map();
    const genreCounts = new Map();
    const profileSampleBase = Math.min(25, uniqueArtists.length);
    const profileFailureRatio = getLastfmFailureRatio(lastfmHealth);
    const profileSampleLimit =
      profileFailureRatio >= 0.5
        ? Math.min(8, profileSampleBase)
        : profileFailureRatio >= 0.3
          ? Math.min(14, profileSampleBase)
          : profileSampleBase;
    const profileSample = [...uniqueArtists]
      .sort(() => 0.5 - Math.random())
      .slice(0, profileSampleLimit);

    console.log(
      `Sampling tags/genres from ${profileSample.length} artists (${libraryArtists.length} library)...`,
    );
    emitDiscoveryProgress(
      "building_genres",
      "Building genre and tag profile",
      35,
    );

    let tagsFound = 0;
    await Promise.all(
      profileSample.map(async (artist) => {
        let foundTags = false;
        if (getLastfmApiKey()) {
          try {
            const data = await lastfmRequest("artist.getTopTags", {
              mbid: artist.mbid,
            });
            recordLastfmResult(lastfmHealth, data);
            if (data?.toptags?.tag) {
              const tags = Array.isArray(data.toptags.tag)
                ? data.toptags.tag
                : [data.toptags.tag];
              tags.slice(0, 15).forEach((t) => {
                tagCounts.set(
                  t.name,
                  (tagCounts.get(t.name) || 0) + (parseInt(t.count) || 1),
                );
                const l = t.name.toLowerCase();
                if (GENRE_KEYWORDS.some((g) => l.includes(g)))
                  genreCounts.set(t.name, (genreCounts.get(t.name) || 0) + 1);
              });
              foundTags = true;
              tagsFound++;
            }
          } catch (e) {
            console.warn(
              `Failed to get Last.fm tags for ${artist.artistName}: ${e.message}`,
            );
          }
        }
      }),
    );
    console.log(
      `Found tags for ${tagsFound} out of ${profileSample.length} artists`,
    );

    discoveryCache.topTags = Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map((t) => t[0]);
    discoveryCache.topGenres = Array.from(genreCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 24)
      .map((t) => t[0]);

    console.log(
      `Identified Top Genres: ${discoveryCache.topGenres.join(", ")}`,
    );

    if (getLastfmApiKey()) {
      console.log("Fetching Global Trending (real-time style) from Last.fm...");
      emitDiscoveryProgress(
        "fetching_trending",
        "Fetching global trending artists",
        50,
      );
      try {
        const trackData = await lastfmRequest("chart.getTopTracks", {
          limit: getLastfmFailureRatio(lastfmHealth) >= 0.3 ? 60 : 100,
        });
        recordLastfmResult(lastfmHealth, trackData);
        const seenMbids = new Set();
        const seenNames = new Set();
        const artistsFromTracks = [];
        if (trackData?.tracks?.track) {
          const tracks = Array.isArray(trackData.tracks.track)
            ? trackData.tracks.track
            : [trackData.tracks.track];
          for (const t of tracks) {
            const artist = t.artist;
            if (!artist) continue;
            const mbid = (artist.mbid && artist.mbid.trim()) || null;
            const name = artist.name || artist["#text"];
            if (!name) continue;
            if (
              (mbid && seenMbids.has(mbid)) ||
              (!mbid && seenNames.has(name.toLowerCase()))
            )
              continue;
            if (mbid) seenMbids.add(mbid);
            seenNames.add(name.toLowerCase());
            let img = null;
            if (t.image && Array.isArray(t.image)) {
              const i =
                t.image.find((im) => im.size === "extralarge") ||
                t.image.find((im) => im.size === "large");
              if (
                i &&
                i["#text"] &&
                !i["#text"].includes("2a96cbd8b46e442fc41c2b86b821562f")
              )
                img = i["#text"];
            }
            artistsFromTracks.push({
              id: mbid,
              name,
              image: img,
              type: "Artist",
            });
          }
        }
        let globalTop = artistsFromTracks
          .filter((a) => !a.id || !existingArtistIds.has(a.id))
          .slice(0, 32);
        if (globalTop.length < 12) {
          const topData = await lastfmRequest("chart.getTopArtists", {
            limit: getLastfmFailureRatio(lastfmHealth) >= 0.3 ? 60 : 100,
          });
          recordLastfmResult(lastfmHealth, topData);
          if (topData?.artists?.artist) {
            const topArtists = Array.isArray(topData.artists.artist)
              ? topData.artists.artist
              : [topData.artists.artist];
            const fromArtists = topArtists
              .map((a) => {
                let img = null;
                if (a.image && Array.isArray(a.image)) {
                  const i =
                    a.image.find((im) => im.size === "extralarge") ||
                    a.image.find((im) => im.size === "large");
                  if (
                    i &&
                    i["#text"] &&
                    !i["#text"].includes("2a96cbd8b46e442fc41c2b86b821562f")
                  )
                    img = i["#text"];
                }
                return { id: a.mbid, name: a.name, image: img, type: "Artist" };
              })
              .filter((a) => a.id && !existingArtistIds.has(a.id));
            const fillMbids = new Set(
              globalTop.map((a) => a.id).filter(Boolean),
            );
            for (const a of fromArtists) {
              if (globalTop.length >= 32) break;
              if (a.id && !fillMbids.has(a.id)) {
                fillMbids.add(a.id);
                globalTop.push(a);
              }
            }
          }
        }

        const globalFailureRatio = getLastfmFailureRatio(lastfmHealth);
        const maxGlobalResolve =
          globalFailureRatio >= 0.5 ? 10 : globalFailureRatio >= 0.3 ? 18 : 30;
        for (
          let index = 0;
          index < globalTop.length && index < maxGlobalResolve;
          index++
        ) {
          const item = globalTop[index];
          if (!item?.name || item.id) continue;
          const resolvedMbid = musicbrainzGetCachedArtistMbidByName(item.name);
          if (resolvedMbid && resolvedMbid !== item.id) {
            item.navigateTo = resolvedMbid;
          }
        }

        discoveryCache.globalTop = globalTop;
        console.log(
          `Found ${discoveryCache.globalTop.length} trending artists (from top tracks).`,
        );
      } catch (e) {
        console.error(`Failed to fetch Global Top: ${e.message}`);
      }
    }

    const recFailureRatio = getLastfmFailureRatio(lastfmHealth);
    const recSampleBase = Math.min(25, uniqueArtists.length);
    const recSampleSize =
      recFailureRatio >= 0.5
        ? Math.min(8, recSampleBase)
        : recFailureRatio >= 0.3
          ? Math.min(14, recSampleBase)
          : recSampleBase;
    const recSample = [...uniqueArtists]
      .sort(() => 0.5 - Math.random())
      .slice(0, recSampleSize);
    const recommendations = new Map();

    console.log(
      `Generating recommendations based on ${recSample.length} library artists...`,
    );
    emitDiscoveryProgress(
      "generating_recommendations",
      "Generating personalized recommendations",
      65,
    );

    if (getLastfmApiKey()) {
      let successCount = 0;
      let errorCount = 0;
      await Promise.all(
        recSample.map(async (artist) => {
          try {
            let sourceTags = [];
            const tagData = await lastfmRequest("artist.getTopTags", {
              mbid: artist.mbid,
            });
            recordLastfmResult(lastfmHealth, tagData);
            if (tagData?.toptags?.tag) {
              const allTags = Array.isArray(tagData.toptags.tag)
                ? tagData.toptags.tag
                : [tagData.toptags.tag];
              sourceTags = allTags.slice(0, 15).map((t) => t.name);
            }

            const similar = await lastfmRequest("artist.getSimilar", {
              mbid: artist.mbid,
              limit: getLastfmFailureRatio(lastfmHealth) >= 0.3 ? 12 : 25,
            });
            recordLastfmResult(lastfmHealth, similar);
            if (similar?.similarartists?.artist) {
              const list = Array.isArray(similar.similarartists.artist)
                ? similar.similarartists.artist
                : [similar.similarartists.artist];
              for (const s of list) {
                if (
                  s.mbid &&
                  !existingArtistIds.has(s.mbid) &&
                  !recommendations.has(s.mbid)
                ) {
                  let img = null;
                  if (s.image && Array.isArray(s.image)) {
                    const i =
                      s.image.find((img) => img.size === "extralarge") ||
                      s.image.find((img) => img.size === "large");
                    if (
                      i &&
                      i["#text"] &&
                      !i["#text"].includes("2a96cbd8b46e442fc41c2b86b821562f")
                    )
                      img = i["#text"];
                  }
                  recommendations.set(s.mbid, {
                    id: s.mbid,
                    name: s.name,
                    type: "Artist",
                    sourceArtist: artist.artistName,
                    sourceType: artist.source || "library",
                    tags: sourceTags,
                    score: Math.round((s.match || 0) * 100),
                    image: img,
                  });
                }
              }
              successCount++;
            } else {
              errorCount++;
            }
          } catch (e) {
            errorCount++;
            console.warn(
              `Error getting similar artists for ${artist.artistName}: ${e.message}`,
            );
          }
        }),
      );
      console.log(
        `Recommendation generation: ${successCount} succeeded, ${errorCount} failed`,
      );
    } else {
      console.warn("Last.fm API key required for similar artist discovery.");
    }

    const recommendationsPerRefresh = getDiscoveryRecommendationsPerRefresh();
    const recommendationsArray = Array.from(recommendations.values())
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, recommendationsPerRefresh);

    const recommendationFailureRatio = getLastfmFailureRatio(lastfmHealth);
    const maxResolve =
      recommendationFailureRatio >= 0.5
        ? 10
        : recommendationFailureRatio >= 0.3
          ? 18
          : 30;
    for (
      let index = 0;
      index < recommendationsArray.length && index < maxResolve;
      index++
    ) {
      const item = recommendationsArray[index];
      if (!item?.name || item.id) continue;
      const resolvedMbid = musicbrainzGetCachedArtistMbidByName(item.name);
      if (resolvedMbid && resolvedMbid !== item.id) {
        item.navigateTo = resolvedMbid;
      }
    }

    console.log(
      `Generated ${recommendationsArray.length} total recommendations.`,
    );

    const discoveryData = {
      recommendations: recommendationsArray,
      basedOn: recSample.map((a) => ({
        name: a.artistName,
        id: a.mbid,
        source: a.source || "library",
      })),
      topTags: discoveryCache.topTags || [],
      topGenres: discoveryCache.topGenres || [],
      globalTop: discoveryCache.globalTop || [],
      lastUpdated: new Date().toISOString(),
    };

    Object.assign(discoveryCache, discoveryData);
    dbOps.updateDiscoveryCache(discoveryData);
    emitDiscoveryProgress(
      "saving_results",
      "Saving refreshed discovery cache",
      82,
    );
    const { notifyDiscoveryUpdated } = await import("./notificationService.js");
    notifyDiscoveryUpdated().catch((err) =>
      console.warn("[Discovery] Notification failed:", err.message),
    );
    console.log(
      `Discovery data written to database: ${discoveryData.recommendations.length} recommendations, ${discoveryData.topGenres.length} genres, ${discoveryData.globalTop.length} trending`,
    );

    const allToHydrate = [
      ...(discoveryCache.globalTop || []),
      ...recommendationsArray,
    ].filter((a) => !a.image);
    console.log(`Hydrating images for ${allToHydrate.length} artists...`);
    emitDiscoveryProgress("hydrating_images", "Hydrating artist images", 90);

    const batchSize = 10;
    for (let i = 0; i < allToHydrate.length; i += batchSize) {
      const batch = allToHydrate.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (item) => {
          try {
            try {
              const artistName = item.name || item.artistName;

              if (artistName) {
                try {
                  const deezer = await deezerSearchArtist(artistName);
                  if (deezer?.imageUrl) {
                    item.image = deezer.imageUrl;
                  }
                } catch (e) {}
              }
            } catch (e) {}
          } catch (e) {}
        }),
      );

      if (i + batchSize < allToHydrate.length) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    console.log("Discovery cache updated successfully.");
    console.log(
      `Summary: ${recommendationsArray.length} recommendations, ${discoveryCache.topGenres.length} genres, ${discoveryCache.globalTop.length} trending artists`,
    );
    const blocklist = getStoredBlocklist();
    websocketService.emitDiscoveryUpdate({
      recommendations: applyBlocklistToArtistCollection(
        discoveryData.recommendations,
        blocklist,
      ),
      globalTop: applyBlocklistToArtistCollection(
        discoveryData.globalTop,
        blocklist,
      ),
      basedOn: discoveryData.basedOn,
      topTags: applyBlocklistToTagList(discoveryData.topTags, blocklist),
      topGenres: applyBlocklistToTagList(discoveryData.topGenres, blocklist),
      lastUpdated: discoveryData.lastUpdated,
      isUpdating: false,
      configured: true,
      phase: "completed",
      progress: 100,
      progressMessage: "Discovery refresh completed",
    });

    try {
      const cleaned = dbOps.cleanOldImageCache(30);
      if (cleaned?.changes > 0) {
        console.log(
          `[Discovery] Cleaned ${cleaned.changes} old image cache entries`,
        );
      }
      dbOps.cleanOldMusicbrainzArtistMbidCache(90);
    } catch (e) {
      console.warn("[Discovery] Failed to clean old image cache:", e.message);
    }
  } catch (error) {
    console.error("Failed to update discovery cache:", error.message);
    console.error("Stack trace:", error.stack);
    websocketService.emitDiscoveryUpdate({
      isUpdating: false,
      configured: true,
      phase: "error",
      progress: 100,
      progressMessage: "Discovery refresh failed",
      error: error.message,
    });
  } finally {
    discoveryCache.isUpdating = false;
  }
};

const userDiscoveryLocks = new Set();

export const updateUserDiscoveryCache = async (listenHistoryProfile) => {
  const profile = getListenHistoryProfile(listenHistoryProfile);
  const cacheNamespace = getListenHistoryCacheNamespace(profile);
  if (!cacheNamespace) return null;
  if (!getLastfmApiKey()) return null;
  if (userDiscoveryLocks.has(cacheNamespace)) return null;

  userDiscoveryLocks.add(cacheNamespace);
  console.log(
    `[Discovery] Starting per-user refresh for ${profile.listenHistoryProvider} user ${profile.listenHistoryUsername}...`,
  );

  try {
    const allLibraryArtistsRaw = await libraryManager.getAllArtists();
    const allLibraryArtists = Array.isArray(allLibraryArtistsRaw)
      ? allLibraryArtistsRaw
      : [];
    const existingArtistIds = new Set(
      allLibraryArtists
        .map((a) => a.mbid || a.foreignArtistId || a.id)
        .filter(Boolean),
    );

    const lastfmHealth = createLastfmHealth();
    const discoveryPeriod = getLastfmDiscoveryPeriod();
    const lastfmArtists = [];

    if (discoveryPeriod !== "none") {
      console.log(
        `[Discovery] Fetching ${profile.listenHistoryProvider} top artists for ${profile.listenHistoryUsername} (period: ${discoveryPeriod})...`,
      );
      try {
        const historyArtists = await fetchListenHistoryArtists(
          profile,
          discoveryPeriod,
          lastfmHealth,
        );
        lastfmArtists.push(...historyArtists);
        console.log(
          `[Discovery] Found ${lastfmArtists.length} ${profile.listenHistoryProvider} artists for ${profile.listenHistoryUsername}.`,
        );
      } catch (e) {
        console.error(
          `[Discovery] Failed to fetch ${profile.listenHistoryProvider} artists for ${profile.listenHistoryUsername}: ${e.message}`,
        );
      }
    }

    const allSourceArtists = [
      ...allLibraryArtists.slice(0, 25).map((a) => ({
        mbid: a.mbid,
        artistName: a.artistName,
        source: "library",
      })),
      ...lastfmArtists.map((a) => ({
        mbid: a.mbid,
        artistName: a.artistName,
        source: profile.listenHistoryProvider,
      })),
    ];

    const uniqueArtists = [];
    const seenMbids = new Set();
    for (const artist of allSourceArtists) {
      if (artist.mbid && !seenMbids.has(artist.mbid)) {
        seenMbids.add(artist.mbid);
        uniqueArtists.push(artist);
      }
    }

    // Build per-user tag/genre profile
    const tagCounts = new Map();
    const genreCounts = new Map();
    const profileSample = [...uniqueArtists]
      .sort(() => 0.5 - Math.random())
      .slice(0, 20);

    await Promise.all(
      profileSample.map(async (artist) => {
        try {
          const data = await lastfmRequest("artist.getTopTags", {
            mbid: artist.mbid,
          });
          recordLastfmResult(lastfmHealth, data);
          if (data?.toptags?.tag) {
            const tags = Array.isArray(data.toptags.tag)
              ? data.toptags.tag
              : [data.toptags.tag];
            tags.slice(0, 15).forEach((t) => {
              tagCounts.set(
                t.name,
                (tagCounts.get(t.name) || 0) + (parseInt(t.count) || 1),
              );
              const l = t.name.toLowerCase();
              if (GENRE_KEYWORDS.some((g) => l.includes(g)))
                genreCounts.set(t.name, (genreCounts.get(t.name) || 0) + 1);
            });
          }
        } catch (e) {
          console.warn(
            `[Discovery] Failed to get tags for ${artist.artistName}: ${e.message}`,
          );
        }
      }),
    );

    const topTags = Array.from(tagCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map((t) => t[0]);
    const topGenres = Array.from(genreCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 24)
      .map((t) => t[0]);

    // Generate per-user recommendations
    const recSample = [...uniqueArtists]
      .sort(() => 0.5 - Math.random())
      .slice(0, 20);
    const recommendations = new Map();

    await Promise.all(
      recSample.map(async (artist) => {
        try {
          let sourceTags = [];
          const tagData = await lastfmRequest("artist.getTopTags", {
            mbid: artist.mbid,
          });
          recordLastfmResult(lastfmHealth, tagData);
          if (tagData?.toptags?.tag) {
            const allTags = Array.isArray(tagData.toptags.tag)
              ? tagData.toptags.tag
              : [tagData.toptags.tag];
            sourceTags = allTags.slice(0, 15).map((t) => t.name);
          }

          const similar = await lastfmRequest("artist.getSimilar", {
            mbid: artist.mbid,
            limit: 20,
          });
          recordLastfmResult(lastfmHealth, similar);
          if (similar?.similarartists?.artist) {
            const list = Array.isArray(similar.similarartists.artist)
              ? similar.similarartists.artist
              : [similar.similarartists.artist];
            for (const s of list) {
              if (
                s.mbid &&
                !existingArtistIds.has(s.mbid) &&
                !recommendations.has(s.mbid)
              ) {
                let img = null;
                if (s.image && Array.isArray(s.image)) {
                  const i =
                    s.image.find((im) => im.size === "extralarge") ||
                    s.image.find((im) => im.size === "large");
                  if (
                    i &&
                    i["#text"] &&
                    !i["#text"].includes("2a96cbd8b46e442fc41c2b86b821562f")
                  )
                    img = i["#text"];
                }
                recommendations.set(s.mbid, {
                  id: s.mbid,
                  name: s.name,
                  type: "Artist",
                  sourceArtist: artist.artistName,
                  sourceType: artist.source || "library",
                  tags: sourceTags,
                  score: Math.round((s.match || 0) * 100),
                  image: img,
                });
              }
            }
          }
        } catch (e) {
          console.warn(
            `[Discovery] Error getting similar for ${artist.artistName}: ${e.message}`,
          );
        }
      }),
    );

    const recommendationsPerRefresh = getDiscoveryRecommendationsPerRefresh();
    const recommendationsArray = Array.from(recommendations.values())
      .sort((a, b) => (b.score || 0) - (a.score || 0))
      .slice(0, recommendationsPerRefresh);

    // Hydrate images
    const toHydrate = recommendationsArray.filter((a) => !a.image);
    const batchSize = 10;
    for (let i = 0; i < toHydrate.length; i += batchSize) {
      const batch = toHydrate.slice(i, i + batchSize);
      await Promise.all(
        batch.map(async (item) => {
          try {
            const artistName = item.name || item.artistName;
            if (artistName) {
              const deezer = await deezerSearchArtist(artistName);
              if (deezer?.imageUrl) item.image = deezer.imageUrl;
            }
          } catch {}
        }),
      );
      if (i + batchSize < toHydrate.length) {
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
    }

    const userData = {
      recommendations: recommendationsArray,
      basedOn: recSample.map((a) => ({
        name: a.artistName,
        id: a.mbid,
        source: a.source || "library",
      })),
      topTags,
      topGenres,
    };

    dbOps.updateDiscoveryCache(userData, cacheNamespace);
    console.log(
      `[Discovery] ${profile.listenHistoryProvider}:${profile.listenHistoryUsername} refresh complete: ${recommendationsArray.length} recommendations, ${topGenres.length} genres.`,
    );
    return userData;
  } catch (error) {
    console.error(
      `[Discovery] Failed to update cache for ${profile.listenHistoryProvider}:${profile.listenHistoryUsername}: ${error.message}`,
    );
    return null;
  } finally {
    userDiscoveryLocks.delete(cacheNamespace);
  }
};

export const getUserDiscoveryCacheStaleness = (cacheNamespace) => {
  const data = dbOps.getDiscoveryCache(cacheNamespace);
  if (!data.lastUpdated) return Infinity;
  return Date.now() - new Date(data.lastUpdated).getTime();
};
