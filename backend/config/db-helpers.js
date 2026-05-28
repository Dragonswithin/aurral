import crypto from "crypto";
import { db, dbHelpers } from "./db-sqlite.js";
import { decryptIntegrations, encryptIntegrations } from "./encryption.js";
import {
  DEFAULT_LISTEN_HISTORY_PROVIDER,
  getListenHistoryProfile,
  hasListenHistoryProfile,
  normalizeListenHistoryProvider,
  normalizeListenHistoryUsername,
} from "../services/listeningHistory.js";

const getSettingStmt = db.prepare("SELECT value FROM settings WHERE key = ?");
const upsertSettingStmt = db.prepare(
  "INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)"
);

const getDiscoveryCacheStmt = db.prepare(
  "SELECT value, last_updated FROM discovery_cache WHERE key = ?"
);
const getDiscoveryCacheLastUpdatedStmt = db.prepare(
  "SELECT last_updated FROM discovery_cache ORDER BY last_updated DESC LIMIT 1"
);
const upsertDiscoveryCacheStmt = db.prepare(
  "INSERT OR REPLACE INTO discovery_cache (key, value, last_updated) VALUES (?, ?, ?)"
);

const getImageStmt = db.prepare("SELECT * FROM images_cache WHERE mbid = ?");
const upsertImageStmt = db.prepare(
  "INSERT OR REPLACE INTO images_cache (mbid, image_url, cache_age, created_at) VALUES (?, ?, ?, ?)"
);
const getAllImagesStmt = db.prepare("SELECT * FROM images_cache");
const countImagesStmt = db.prepare("SELECT COUNT(*) as count FROM images_cache");
const deleteImageStmt = db.prepare("DELETE FROM images_cache WHERE mbid = ?");
const clearImagesStmt = db.prepare("DELETE FROM images_cache");
const cleanOldImagesStmt = db.prepare(
  "DELETE FROM images_cache WHERE cache_age < ?"
);

// NOT_FOUND entries expire after 7 days so covers added later get picked up
const NOT_FOUND_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const getDeezerMbidCacheStmt = db.prepare(
  "SELECT mbid FROM deezer_mbid_cache WHERE cache_key = ?"
);
const setDeezerMbidCacheStmt = db.prepare(
  "INSERT OR REPLACE INTO deezer_mbid_cache (cache_key, mbid) VALUES (?, ?)"
);
const getMusicbrainzArtistMbidCacheStmt = db.prepare(
  "SELECT mbid, updated_at FROM musicbrainz_artist_mbid_cache WHERE artist_name_key = ?"
);
const setMusicbrainzArtistMbidCacheStmt = db.prepare(
  "INSERT OR REPLACE INTO musicbrainz_artist_mbid_cache (artist_name_key, mbid, updated_at) VALUES (?, ?, ?)"
);
const cleanOldMusicbrainzArtistMbidCacheStmt = db.prepare(
  "DELETE FROM musicbrainz_artist_mbid_cache WHERE updated_at < ?"
);

const getArtistOverrideStmt = db.prepare(
  "SELECT * FROM artist_overrides WHERE mbid = ?"
);
const upsertArtistOverrideStmt = db.prepare(
  "INSERT OR REPLACE INTO artist_overrides (mbid, musicbrainz_id, deezer_artist_id, updated_at) VALUES (?, ?, ?, ?)"
);
const deleteArtistOverrideStmt = db.prepare(
  "DELETE FROM artist_overrides WHERE mbid = ?"
);

const getUserByUsernameStmt = db.prepare(
  "SELECT * FROM users WHERE username = ?"
);
const getAllUsersStmt = db.prepare(
  "SELECT id, username, role, permissions, lastfm_username, listen_history_provider, listen_history_username, lidarr_root_folder_path, lidarr_quality_profile_id, discover_layout FROM users ORDER BY username"
);
const getUserByIdStmt = db.prepare("SELECT * FROM users WHERE id = ?");
const insertUserStmt = db.prepare(
  "INSERT INTO users (username, password_hash, role, permissions, lidarr_root_folder_path, lidarr_quality_profile_id, discover_layout) VALUES (?, ?, ?, ?, ?, ?, ?)"
);
const updateUserStmt = db.prepare(
  "UPDATE users SET username = ?, password_hash = ?, role = ?, permissions = ?, lastfm_username = ?, listen_history_provider = ?, listen_history_username = ?, lidarr_root_folder_path = ?, lidarr_quality_profile_id = ?, discover_layout = ? WHERE id = ?"
);
const deleteUserStmt = db.prepare("DELETE FROM users WHERE id = ?");
const getAllListeningHistoryUsersStmt = db.prepare(
  "SELECT id, username, lastfm_username, listen_history_provider, listen_history_username FROM users WHERE listen_history_username IS NOT NULL AND TRIM(listen_history_username) != ''"
);

const DEFAULT_PERMISSIONS = {
  accessFlow: false,
  addArtist: true,
  addAlbum: true,
  changeMonitoring: false,
  deleteArtist: false,
  deleteAlbum: false,
};

const normalizeExistingFileMode = (value) => {
  const normalized = String(value || "").trim().toLowerCase();
  return ["download", "hardlink", "copy"].includes(normalized)
    ? normalized
    : "hardlink";
};

export const userOps = {
  getDefaultPermissions() {
    return { ...DEFAULT_PERMISSIONS };
  },
  getUserByUsername(username) {
    const row = getUserByUsernameStmt.get(
      String(username).trim().toLowerCase()
    );
    if (!row) return null;
    const history = getListenHistoryProfile(row);
    return {
      id: row.id,
      username: row.username,
      passwordHash: row.password_hash,
      role: row.role || "user",
      permissions: dbHelpers.parseJSON(row.permissions) || {
        ...DEFAULT_PERMISSIONS,
      },
      lidarrRootFolderPath: row.lidarr_root_folder_path || null,
      lidarrQualityProfileId:
        row.lidarr_quality_profile_id != null
          ? Number(row.lidarr_quality_profile_id)
          : null,
      discoverLayout: dbHelpers.parseJSON(row.discover_layout) || null,
      ...history,
    };
  },
  getUserById(id) {
    const row = getUserByIdStmt.get(parseInt(id, 10));
    if (!row) return null;
    const history = getListenHistoryProfile(row);
    return {
      id: row.id,
      username: row.username,
      passwordHash: row.password_hash,
      role: row.role || "user",
      permissions: dbHelpers.parseJSON(row.permissions) || {
        ...DEFAULT_PERMISSIONS,
      },
      lidarrRootFolderPath: row.lidarr_root_folder_path || null,
      lidarrQualityProfileId:
        row.lidarr_quality_profile_id != null
          ? Number(row.lidarr_quality_profile_id)
          : null,
      ...history,
    };
  },
  getAllUsers() {
    const rows = getAllUsersStmt.all();
    return rows.map((r) => ({
      ...getListenHistoryProfile(r),
      id: r.id,
      username: r.username,
      role: r.role || "user",
      permissions: dbHelpers.parseJSON(r.permissions) || {
        ...DEFAULT_PERMISSIONS,
      },
      lidarrRootFolderPath: r.lidarr_root_folder_path || null,
      lidarrQualityProfileId:
        r.lidarr_quality_profile_id != null
          ? Number(r.lidarr_quality_profile_id)
          : null,
      discoverLayout: dbHelpers.parseJSON(r.discover_layout) || null,
    }));
  },
  createUser(username, passwordHash, role = "user", permissions = null) {
    const un = String(username).trim();
    if (!un) return null;
    const perms = permissions
      ? { ...DEFAULT_PERMISSIONS, ...permissions }
      : { ...DEFAULT_PERMISSIONS };
    try {
      const result = insertUserStmt.run(
        un.toLowerCase(),
        passwordHash,
        role,
        dbHelpers.stringifyJSON(perms),
        null,
        null,
        null,
      );
      return {
        id: result.lastInsertRowid,
        username: un,
        role,
        permissions: perms,
        listenHistoryProvider: DEFAULT_LISTEN_HISTORY_PROVIDER,
        listenHistoryUsername: null,
        lastfmUsername: null,
        lidarrRootFolderPath: null,
        lidarrQualityProfileId: null,
        discoverLayout: null,
      };
    } catch (e) {
      return null;
    }
  },
  updateUser(id, data) {
    const existing = userOps.getUserById(id);
    if (!existing) return null;
    const username =
      data.username !== undefined
        ? String(data.username).trim()
        : existing.username;
    const passwordHash =
      data.passwordHash !== undefined
        ? data.passwordHash
        : existing.passwordHash;
    const role = data.role !== undefined ? data.role : existing.role;
    const permissions =
      data.permissions !== undefined
        ? { ...DEFAULT_PERMISSIONS, ...data.permissions }
        : existing.permissions;
    const listenHistoryProvider = normalizeListenHistoryProvider(
      data.listenHistoryProvider !== undefined
        ? data.listenHistoryProvider
        : data.lastfmUsername !== undefined
          ? "lastfm"
          : existing.listenHistoryProvider,
    );
    const listenHistoryUsername = normalizeListenHistoryUsername(
      data.listenHistoryUsername !== undefined
        ? data.listenHistoryUsername
        : data.lastfmUsername !== undefined
          ? data.lastfmUsername
          : existing.listenHistoryUsername,
    );
    const lastfmUsername =
      listenHistoryProvider === "lastfm" ? listenHistoryUsername : null;
    const lidarrRootFolderPath =
      data.lidarrRootFolderPath !== undefined
        ? data.lidarrRootFolderPath
          ? String(data.lidarrRootFolderPath).trim()
          : null
        : existing.lidarrRootFolderPath;
    const parsedLidarrQualityProfileId =
      data.lidarrQualityProfileId !== undefined &&
      data.lidarrQualityProfileId !== null
        ? Number(data.lidarrQualityProfileId)
        : data.lidarrQualityProfileId === null
          ? null
          : existing.lidarrQualityProfileId;
    const lidarrQualityProfileId =
      parsedLidarrQualityProfileId != null &&
      Number.isFinite(parsedLidarrQualityProfileId)
        ? Math.trunc(parsedLidarrQualityProfileId)
        : parsedLidarrQualityProfileId === null
          ? null
          : existing.lidarrQualityProfileId;
    const discoverLayout =
      data.discoverLayout !== undefined ? data.discoverLayout : existing.discoverLayout;
    try {
      updateUserStmt.run(
        username.toLowerCase(),
        passwordHash,
        role,
        dbHelpers.stringifyJSON(permissions),
        lastfmUsername,
        listenHistoryProvider,
        listenHistoryUsername,
        lidarrRootFolderPath,
        lidarrQualityProfileId,
        dbHelpers.stringifyJSON(discoverLayout),
        parseInt(id, 10)
      );
      return {
        id: parseInt(id, 10),
        username,
        role,
        permissions,
        listenHistoryProvider,
        listenHistoryUsername,
        lastfmUsername,
        lidarrRootFolderPath,
        lidarrQualityProfileId,
        discoverLayout,
      };
    } catch (e) {
      return null;
    }
  },
  deleteUser(id) {
    try {
      deleteUserStmt.run(parseInt(id, 10));
      return true;
    } catch (e) {
      return false;
    }
  },
  getAllListeningHistoryUsers() {
    return getAllListeningHistoryUsersStmt.all().map((r) => ({
      id: r.id,
      username: r.username,
      ...getListenHistoryProfile(r),
    }));
  },
  getAllLastfmUsers() {
    return userOps
      .getAllListeningHistoryUsers()
      .filter((user) => hasListenHistoryProfile(user) && user.lastfmUsername);
  },
};

function getOrCreateEncryptionKey() {
  const row = getSettingStmt.get("_encryptionKey");
  if (row?.value) {
    return Buffer.from(row.value, "base64");
  }
  const key = crypto.randomBytes(32);
  upsertSettingStmt.run("_encryptionKey", key.toString("base64"));
  return key;
}

let settingsCache = null;
let settingsCacheTime = 0;
const SETTINGS_CACHE_TTL = 5000;

export const dbOps = {
  getJSONSetting(key) {
    return dbHelpers.parseJSON(getSettingStmt.get(key)?.value) || null;
  },

  setJSONSetting(key, value) {
    upsertSettingStmt.run(key, dbHelpers.stringifyJSON(value));
  },

  getUserDiscoverLayout(userId) {
    return dbOps.getJSONSetting(`user:${parseInt(userId, 10)}:discoverLayout`);
  },

  setUserDiscoverLayout(userId, layout) {
    dbOps.setJSONSetting(
      `user:${parseInt(userId, 10)}:discoverLayout`,
      layout,
    );
  },

  getSettings() {
    const now = Date.now();
    if (settingsCache && now - settingsCacheTime < SETTINGS_CACHE_TTL) {
      return settingsCache;
    }

    const integrations = dbHelpers.parseJSON(
      getSettingStmt.get("integrations")?.value
    );
    const encKey = getOrCreateEncryptionKey();
    const quality = getSettingStmt.get("quality")?.value;
    const queueCleaner = dbHelpers.parseJSON(
      getSettingStmt.get("queueCleaner")?.value
    );
    const security = dbHelpers.parseJSON(
      getSettingStmt.get("security")?.value
    );
    const rootFolderPath = getSettingStmt.get("rootFolderPath")?.value;
    const releaseTypes = dbHelpers.parseJSON(
      getSettingStmt.get("releaseTypes")?.value
    );
    const weeklyFlowPlaylists = dbHelpers.parseJSON(
      getSettingStmt.get("weeklyFlowPlaylists")?.value
    );
    const weeklyFlows = dbHelpers.parseJSON(
      getSettingStmt.get("weeklyFlows")?.value
    );
    const sharedFlowPlaylists = dbHelpers.parseJSON(
      getSettingStmt.get("sharedFlowPlaylists")?.value
    );
    const weeklyFlowWorker = dbHelpers.parseJSON(
      getSettingStmt.get("weeklyFlowWorker")?.value
    );
    const blocklist = dbHelpers.parseJSON(
      getSettingStmt.get("blocklist")?.value
    );
    const onboardingComplete =
      getSettingStmt.get("onboardingComplete")?.value === "true";
    const parsedConcurrency = Number(weeklyFlowWorker?.concurrency);
    const concurrency =
      Number.isFinite(parsedConcurrency) && parsedConcurrency >= 1
        ? Math.min(3, Math.floor(parsedConcurrency))
        : 2;
    const preferredFormat =
      String(weeklyFlowWorker?.preferredFormat || "").toLowerCase() === "mp3"
        ? "mp3"
        : "flac";
    const preferredFormatStrict = weeklyFlowWorker?.preferredFormatStrict === true;
    const parsedRetryCycleMinutes = Number(weeklyFlowWorker?.retryCycleMinutes);
    const retryCycleMinutes =
      Number.isFinite(parsedRetryCycleMinutes) &&
      [15, 30, 60, 360, 720, 1440].includes(
        Math.floor(parsedRetryCycleMinutes),
      )
        ? Math.floor(parsedRetryCycleMinutes)
        : 15;
    const retryPausedPlaylistIds = Array.isArray(
      weeklyFlowWorker?.retryPausedPlaylistIds,
    )
      ? [...new Set(
          weeklyFlowWorker.retryPausedPlaylistIds
            .map((entry) => String(entry || "").trim())
            .filter(Boolean),
        )]
      : [];
    const existingFileMode = normalizeExistingFileMode(
      weeklyFlowWorker?.existingFileMode,
    );

    const defaultFlowPlaylists = {
      discover: { enabled: false, nextRunAt: null },
      mix: { enabled: false, nextRunAt: null },
      trending: { enabled: false, nextRunAt: null },
    };
    const merged = weeklyFlowPlaylists
      ? { ...defaultFlowPlaylists, ...weeklyFlowPlaylists }
      : defaultFlowPlaylists;
    if (merged.recommended) {
      merged.discover = {
        ...defaultFlowPlaylists.discover,
        ...merged.discover,
        ...merged.recommended,
      };
    }
    delete merged.recommended;

    const result = {
      integrations: decryptIntegrations(integrations, encKey) || {},
      quality: quality || "standard",
      queueCleaner: queueCleaner || {},
      security:
        security && typeof security === "object"
          ? security
          : { localNetworkBypass: { enabled: false } },
      rootFolderPath: rootFolderPath || null,
      releaseTypes: releaseTypes || [],
      weeklyFlowPlaylists: merged,
      weeklyFlows: weeklyFlows || null,
      sharedFlowPlaylists: sharedFlowPlaylists || null,
      weeklyFlowWorker: {
        concurrency,
        preferredFormat,
        preferredFormatStrict,
        retryCycleMinutes,
        retryPausedPlaylistIds,
        existingFileMode,
      },
      blocklist:
        blocklist && typeof blocklist === "object"
          ? blocklist
          : { artists: [], tags: [] },
      onboardingComplete: !!onboardingComplete,
    };
    settingsCache = result;
    settingsCacheTime = Date.now();
    return result;
  },

  updateSettings(settings) {
    settingsCache = null;
    const updateFn = db.transaction(() => {
      if (settings.integrations) {
        const encKey = getOrCreateEncryptionKey();
        upsertSettingStmt.run(
          "integrations",
          dbHelpers.stringifyJSON(
            encryptIntegrations(settings.integrations, encKey)
          )
        );
      }
      if (settings.quality) {
        upsertSettingStmt.run("quality", settings.quality);
      }
      if (settings.queueCleaner) {
        upsertSettingStmt.run(
          "queueCleaner",
          dbHelpers.stringifyJSON(settings.queueCleaner)
        );
      }
      if (settings.security !== undefined) {
        upsertSettingStmt.run(
          "security",
          dbHelpers.stringifyJSON(settings.security)
        );
      }
      if (
        settings.rootFolderPath !== undefined &&
        settings.rootFolderPath !== null
      ) {
        upsertSettingStmt.run("rootFolderPath", settings.rootFolderPath);
      }
      if (settings.releaseTypes) {
        upsertSettingStmt.run(
          "releaseTypes",
          dbHelpers.stringifyJSON(settings.releaseTypes)
        );
      }
      if (settings.weeklyFlowPlaylists !== undefined) {
        upsertSettingStmt.run(
          "weeklyFlowPlaylists",
          dbHelpers.stringifyJSON(settings.weeklyFlowPlaylists)
        );
      }
      if (settings.weeklyFlows !== undefined) {
        upsertSettingStmt.run(
          "weeklyFlows",
          dbHelpers.stringifyJSON(settings.weeklyFlows)
        );
      }
      if (settings.sharedFlowPlaylists !== undefined) {
        upsertSettingStmt.run(
          "sharedFlowPlaylists",
          dbHelpers.stringifyJSON(settings.sharedFlowPlaylists)
        );
      }
      if (settings.weeklyFlowWorker !== undefined) {
        upsertSettingStmt.run(
          "weeklyFlowWorker",
          dbHelpers.stringifyJSON(settings.weeklyFlowWorker)
        );
      }
      if (settings.blocklist !== undefined) {
        upsertSettingStmt.run(
          "blocklist",
          dbHelpers.stringifyJSON(settings.blocklist)
        );
      }
      if (settings.onboardingComplete !== undefined) {
        upsertSettingStmt.run(
          "onboardingComplete",
          settings.onboardingComplete ? "true" : "false"
        );
      }
    });
    updateFn();
  },

  getDiscoveryCache(cacheNamespace = null) {
    const prefix = cacheNamespace ? `${cacheNamespace}:` : "";
    const recommendations = dbHelpers.parseJSON(
      getDiscoveryCacheStmt.get(`${prefix}recommendations`)?.value
    );
    const globalTop = dbHelpers.parseJSON(
      getDiscoveryCacheStmt.get(`${prefix}globalTop`)?.value
    );
    const basedOn = dbHelpers.parseJSON(
      getDiscoveryCacheStmt.get(`${prefix}basedOn`)?.value
    );
    const topTags = dbHelpers.parseJSON(
      getDiscoveryCacheStmt.get(`${prefix}topTags`)?.value
    );
    const topGenres = dbHelpers.parseJSON(
      getDiscoveryCacheStmt.get(`${prefix}topGenres`)?.value
    );
    const fallbackGenres = dbHelpers.parseJSON(
      getDiscoveryCacheStmt.get(`${prefix}fallbackGenres`)?.value
    );
    const fallbackGenrePools = dbHelpers.parseJSON(
      getDiscoveryCacheStmt.get(`${prefix}fallbackGenrePools`)?.value
    );
    const provider =
      getDiscoveryCacheStmt.get(`${prefix}provider`)?.value || null;
    const lastUpdated = cacheNamespace
      ? getDiscoveryCacheStmt.get(`${prefix}lastUpdated`)?.value || null
      : getDiscoveryCacheLastUpdatedStmt.get()?.last_updated;

    return {
      recommendations: recommendations || [],
      globalTop: globalTop || [],
      basedOn: basedOn || [],
      topTags: topTags || [],
      topGenres: topGenres || [],
      fallbackGenres: fallbackGenres || [],
      fallbackGenrePools:
        fallbackGenrePools && typeof fallbackGenrePools === "object"
          ? fallbackGenrePools
          : {},
      provider,
      lastUpdated,
    };
  },

  updateDiscoveryCache(discovery, cacheNamespace = null) {
    const now = new Date().toISOString();
    const prefix = cacheNamespace ? `${cacheNamespace}:` : "";
    const updateFn = db.transaction(() => {
      if (discovery.recommendations) {
        upsertDiscoveryCacheStmt.run(
          `${prefix}recommendations`,
          dbHelpers.stringifyJSON(discovery.recommendations),
          now
        );
      }
      if (discovery.globalTop) {
        upsertDiscoveryCacheStmt.run(
          `${prefix}globalTop`,
          dbHelpers.stringifyJSON(discovery.globalTop),
          now
        );
      }
      if (discovery.basedOn) {
        upsertDiscoveryCacheStmt.run(
          `${prefix}basedOn`,
          dbHelpers.stringifyJSON(discovery.basedOn),
          now
        );
      }
      if (discovery.topTags) {
        upsertDiscoveryCacheStmt.run(
          `${prefix}topTags`,
          dbHelpers.stringifyJSON(discovery.topTags),
          now
        );
      }
      if (discovery.topGenres) {
        upsertDiscoveryCacheStmt.run(
          `${prefix}topGenres`,
          dbHelpers.stringifyJSON(discovery.topGenres),
          now
        );
      }
      if (discovery.fallbackGenres) {
        upsertDiscoveryCacheStmt.run(
          `${prefix}fallbackGenres`,
          dbHelpers.stringifyJSON(discovery.fallbackGenres),
          now
        );
      }
      if (discovery.fallbackGenrePools) {
        upsertDiscoveryCacheStmt.run(
          `${prefix}fallbackGenrePools`,
          dbHelpers.stringifyJSON(discovery.fallbackGenrePools),
          now
        );
      }
      if (discovery.provider) {
        upsertDiscoveryCacheStmt.run(`${prefix}provider`, discovery.provider, now);
      }
      if (cacheNamespace) {
        upsertDiscoveryCacheStmt.run(
          `${prefix}lastUpdated`,
          now,
          now
        );
      }
    });
    updateFn();
  },

  deleteDiscoveryCacheByPrefix(prefix) {
    return db.prepare("DELETE FROM discovery_cache WHERE key LIKE ?").run(
      `${prefix}%`
    );
  },

  getImage(mbid) {
    const row = getImageStmt.get(mbid);
    if (!row) return null;
    if (
      row.image_url === "NOT_FOUND" &&
      Date.now() - row.cache_age > NOT_FOUND_TTL_MS
    ) {
      deleteImageStmt.run(mbid);
      return null;
    }
    return {
      mbid: row.mbid,
      imageUrl: row.image_url,
      cacheAge: row.cache_age,
    };
  },

  getImages(mbids) {
    if (!mbids || !mbids.length) return {};
    const placeholders = mbids.map(() => "?").join(",");
    const stmt = db.prepare(
      `SELECT mbid, image_url, cache_age FROM images_cache WHERE mbid IN (${placeholders})`
    );
    const rows = stmt.all(...mbids);
    const now = Date.now();
    const result = {};
    for (const row of rows) {
      if (
        row.image_url === "NOT_FOUND" &&
        now - row.cache_age > NOT_FOUND_TTL_MS
      ) {
        deleteImageStmt.run(row.mbid);
        continue;
      }
      result[row.mbid] = { imageUrl: row.image_url, cacheAge: row.cache_age };
    }
    return result;
  },

  setImage(mbid, imageUrl) {
    upsertImageStmt.run(mbid, imageUrl, Date.now(), new Date().toISOString());
  },

  getAllImages() {
    const rows = getAllImagesStmt.all();
    const images = {};
    for (const row of rows) {
      images[row.mbid] = row.image_url;
    }
    return images;
  },

  countImages() {
    const row = countImagesStmt.get();
    return Number(row?.count || 0);
  },

  deleteImage(mbid) {
    return deleteImageStmt.run(mbid);
  },

  clearImages() {
    return clearImagesStmt.run();
  },

  cleanOldImageCache(maxAgeDays = 30) {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    return cleanOldImagesStmt.run(cutoff);
  },

  getDeezerMbidCache(cacheKey) {
    const row = getDeezerMbidCacheStmt.get(cacheKey);
    return row?.mbid ?? null;
  },

  setDeezerMbidCache(cacheKey, mbid) {
    setDeezerMbidCacheStmt.run(cacheKey, mbid);
  },

  getMusicbrainzArtistMbidCache(artistNameKey) {
    if (!artistNameKey) return null;
    const row = getMusicbrainzArtistMbidCacheStmt.get(artistNameKey);
    if (!row) return null;
    return {
      mbid: row.mbid || null,
      updatedAt: Number(row.updated_at || 0),
    };
  },

  setMusicbrainzArtistMbidCache(artistNameKey, mbid) {
    if (!artistNameKey) return null;
    const updatedAt = Date.now();
    setMusicbrainzArtistMbidCacheStmt.run(artistNameKey, mbid || null, updatedAt);
    return {
      artistNameKey,
      mbid: mbid || null,
      updatedAt,
    };
  },

  cleanOldMusicbrainzArtistMbidCache(maxAgeDays = 90) {
    const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
    return cleanOldMusicbrainzArtistMbidCacheStmt.run(cutoff);
  },

  getArtistOverride(mbid) {
    if (!mbid) return null;
    const row = getArtistOverrideStmt.get(mbid);
    if (!row) return null;
    return {
      mbid: row.mbid,
      musicbrainzId: row.musicbrainz_id || null,
      deezerArtistId: row.deezer_artist_id || null,
      updatedAt: row.updated_at || null,
    };
  },

  setArtistOverride(mbid, { musicbrainzId = null, deezerArtistId = null } = {}) {
    if (!mbid) return null;
    const now = Date.now();
    upsertArtistOverrideStmt.run(
      mbid,
      musicbrainzId || null,
      deezerArtistId || null,
      now
    );
    return {
      mbid,
      musicbrainzId: musicbrainzId || null,
      deezerArtistId: deezerArtistId || null,
      updatedAt: now,
    };
  },

  deleteArtistOverride(mbid) {
    if (!mbid) return null;
    return deleteArtistOverrideStmt.run(mbid);
  },
};
