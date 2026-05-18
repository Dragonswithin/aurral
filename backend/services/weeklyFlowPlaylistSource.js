import { lastfmRequest, getLastfmApiKey } from "./apiClients.js";
import { getDiscoveryCache } from "./discoveryService.js";
import { dbOps } from "../config/db-helpers.js";

const MBID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class WeeklyFlowPlaylistSource {
  constructor() {
    this.artistTopTagsCache = new Map();
    this.relatedArtistMatchCache = new Map();
  }

  _buildCounts(size, mix) {
    const weights = [
      { key: "discover", value: Number(mix?.discover ?? 0) },
      { key: "mix", value: Number(mix?.mix ?? 0) },
      { key: "trending", value: Number(mix?.trending ?? 0) },
      { key: "focus", value: Number(mix?.focus ?? 0) },
    ];
    const sum = weights.reduce(
      (acc, w) => acc + (Number.isFinite(w.value) ? w.value : 0),
      0,
    );
    if (sum <= 0 || !Number.isFinite(sum)) {
      return { discover: 0, mix: 0, trending: 0, focus: 0 };
    }
    const scaled = weights.map((w) => ({
      ...w,
      raw: (w.value / sum) * size,
    }));
    const floored = scaled.map((w) => ({
      ...w,
      count: Math.floor(w.raw),
      remainder: w.raw - Math.floor(w.raw),
    }));
    let remaining = size - floored.reduce((acc, w) => acc + w.count, 0);
    const ordered = [...floored].sort((a, b) => b.remainder - a.remainder);
    for (let i = 0; i < ordered.length && remaining > 0; i++) {
      ordered[i].count += 1;
      remaining -= 1;
    }
    const out = {};
    for (const item of ordered) {
      out[item.key] = item.count;
    }
    return out;
  }

  _normalizeWeightMap(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return {};
    const out = {};
    for (const [key, rawValue] of Object.entries(value)) {
      const name = String(key || "").trim();
      if (!name) continue;
      const parsed = Number(rawValue);
      if (!Number.isFinite(parsed)) continue;
      const rounded = Math.round(parsed);
      if (rounded <= 0) continue;
      out[name] = rounded;
    }
    return out;
  }

  _sumWeightMap(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
    return Object.values(value).reduce((acc, entry) => {
      const parsed = Number(entry);
      return acc + (Number.isFinite(parsed) ? parsed : 0);
    }, 0);
  }

  _normalizeRecipeCounts(value) {
    if (!value || typeof value !== "object" || Array.isArray(value))
      return null;
    const parseField = (entry) => {
      const parsed = Number(entry);
      if (!Number.isFinite(parsed)) return 0;
      return Math.max(Math.round(parsed), 0);
    };
    return {
      discover: parseField(value?.discover ?? 0),
      mix: parseField(value?.mix ?? 0),
      trending: parseField(value?.trending ?? 0),
    };
  }

  _normalizeList(value) {
    if (value == null) return [];
    if (Array.isArray(value)) {
      return value
        .map((item) => String(item || "").trim())
        .filter(Boolean);
    }
    if (typeof value === "string") {
      const trimmed = value.trim();
      return trimmed ? [trimmed] : [];
    }
    return [];
  }

  _normalizeFocusEntries(value) {
    if (Array.isArray(value)) {
      const seen = new Set();
      const out = [];
      for (const entry of value) {
        const text = String(entry || "").trim();
        const key = this._artistKey(text);
        if (!text || seen.has(key)) continue;
        seen.add(key);
        out.push(text);
      }
      return out;
    }
    return Object.keys(this._normalizeWeightMap(value));
  }

  _normalizeFocusStrength(value) {
    const strength = String(value || "").trim().toLowerCase();
    if (strength === "light" || strength === "medium" || strength === "heavy") {
      return strength;
    }
    return null;
  }

  _getStrengthWeight(strength) {
    if (strength === "light") return 0.35;
    if (strength === "medium") return 0.65;
    if (strength === "heavy") return 1;
    return 0;
  }

  _getBlocklist() {
    const settings = dbOps.getSettings();
    const source =
      settings?.blocklist && typeof settings.blocklist === "object"
        ? settings.blocklist
        : {};
    const rawArtists = Array.isArray(source.artists) ? source.artists : [];
    const seen = new Set();
    const artists = [];
    for (const entry of rawArtists) {
      let mbid = null;
      let name = null;
      if (typeof entry === "string") {
        const normalized = String(entry).trim();
        if (!normalized) continue;
        if (MBID_REGEX.test(normalized)) {
          mbid = normalized.toLowerCase();
        } else {
          name = normalized;
        }
      } else if (entry && typeof entry === "object") {
        const rawMbid = String(entry.mbid || entry.artistId || entry.id || "").trim();
        if (rawMbid && MBID_REGEX.test(rawMbid)) {
          mbid = rawMbid.toLowerCase();
        }
        const rawName = String(entry.name || entry.artistName || "").trim();
        if (rawName) {
          name = rawName;
        }
      }
      if (!mbid && !name) continue;
      const key = mbid ? `mbid:${mbid}` : `name:${this._artistKey(name)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      artists.push({ mbid, name: name || null });
    }
    const tags = Array.isArray(source.tags)
      ? [...new Set(source.tags.map((entry) => this._artistKey(entry)).filter(Boolean))]
      : [];
    return {
      artists,
      tags,
    };
  }

  _isArtistBlockedByBlocklist(artist, blocklist) {
    const blockedArtists = Array.isArray(blocklist?.artists) ? blocklist.artists : [];
    if (blockedArtists.length === 0) return false;
    const blockedMbids = new Set(
      blockedArtists
        .map((entry) => this._artistKey(entry?.mbid))
        .filter((value) => MBID_REGEX.test(value)),
    );
    const blockedNames = new Set(
      blockedArtists
        .map((entry) => this._artistKey(entry?.name))
        .filter(Boolean),
    );
    const keys = this._artistKeysFromArtist(artist);
    return keys.some((key) => blockedMbids.has(key) || blockedNames.has(key));
  }

  _isTagBlockedByBlocklist(tags, blocklist) {
    const blockedTags = new Set(blocklist?.tags || []);
    if (blockedTags.size === 0) return false;
    const normalized = Array.isArray(tags)
      ? tags.map((tag) => this._artistKey(tag)).filter(Boolean)
      : [];
    return normalized.some((tag) => blockedTags.has(tag));
  }

  _filterArtistsByBlocklist(artists, blocklist) {
    if (!Array.isArray(artists) || artists.length === 0) return [];
    return artists.filter(
      (artist) =>
        !this._isArtistBlockedByBlocklist(artist, blocklist) &&
        !this._isTagBlockedByBlocklist(artist?.tags, blocklist),
    );
  }

  _filterTracksByBlocklist(tracks, blocklist) {
    const blockedArtists = Array.isArray(blocklist?.artists) ? blocklist.artists : [];
    const blockedMbids = new Set(
      blockedArtists
        .map((entry) => this._artistKey(entry?.mbid))
        .filter((value) => MBID_REGEX.test(value)),
    );
    const blockedNames = new Set(
      blockedArtists
        .map((entry) => this._artistKey(entry?.name))
        .filter(Boolean),
    );
    if (
      !Array.isArray(tracks) ||
      tracks.length === 0 ||
      (blockedNames.size === 0 && blockedMbids.size === 0)
    ) {
      return Array.isArray(tracks) ? tracks : [];
    }
    return tracks.filter((track) => {
      const artistKey = this._artistKey(track?.artistName);
      const artistMbid = this._artistKey(track?.artistMbid);
      if (artistMbid && blockedMbids.has(artistMbid)) return false;
      return artistKey && !blockedNames.has(artistKey);
    });
  }


  _artistKey(value) {
    return String(value || "").trim().toLowerCase();
  }

  _artistKeysFromArtist(artist) {
    return [
      artist?.id,
      artist?.mbid,
      artist?.foreignArtistId,
      artist?.name,
      artist?.artistName,
    ]
      .map((value) => this._artistKey(value))
      .filter(Boolean);
  }

  _trackArtistKey(track) {
    const key = this._artistKey(track?.artistName);
    return key || null;
  }

  _normalizeTrackReason(value, fallback = "Flow selection") {
    const text = String(value || "").trim();
    return text || fallback;
  }

  _buildTrackEntry({
    artistName,
    trackName,
    albumName,
    artistMbid,
    albumMbid,
    trackMbid,
    releaseYear,
    durationMs,
    artistAliases,
    reason,
  }) {
    const safeArtist = String(artistName || "").trim();
    const safeTrack = String(trackName || "").trim();
    if (!safeArtist || !safeTrack) return null;
    const safeAlbum = String(albumName || "").trim();
    const safeMbid = String(artistMbid || "").trim();
    const safeAlbumMbid = String(albumMbid || "").trim();
    const safeTrackMbid = String(trackMbid || "").trim();
    const safeReleaseYear = String(releaseYear || "").trim();
    const safeDuration =
      durationMs != null && Number.isFinite(Number(durationMs))
        ? Math.max(0, Math.round(Number(durationMs)))
        : null;
    const normalizedAliases = Array.isArray(artistAliases)
      ? artistAliases.map((entry) => String(entry || "").trim()).filter(Boolean)
      : [];
    return {
      artistName: safeArtist,
      trackName: safeTrack,
      albumName: safeAlbum || null,
      artistMbid: safeMbid || null,
      albumMbid: safeAlbumMbid || null,
      trackMbid: safeTrackMbid || null,
      releaseYear: safeReleaseYear || null,
      durationMs: safeDuration,
      artistAliases: normalizedAliases,
      reason: this._normalizeTrackReason(reason),
    };
  }

  _getRecommendedArtists() {
    const discoveryCache = getDiscoveryCache();
    return Array.isArray(discoveryCache.recommendations)
      ? discoveryCache.recommendations
      : [];
  }

  _getRecommendedArtistSet() {
    const set = new Set();
    for (const artist of this._getRecommendedArtists()) {
      if (artist?.id) {
        set.add(this._artistKey(artist.id));
      }
      if (artist?.name) {
        set.add(this._artistKey(artist.name));
      }
      if (artist?.artistName) {
        set.add(this._artistKey(artist.artistName));
      }
    }
    return set;
  }

  _getRecommendedArtistMap() {
    const map = new Map();
    for (const artist of this._getRecommendedArtists()) {
      if (!artist) continue;
      const keys = this._artistKeysFromArtist(artist);
      for (const key of keys) {
        if (!map.has(key)) {
          map.set(key, artist);
        }
      }
    }
    return map;
  }

  _getRecommendedArtistsByTags(tags, match) {
    const wanted = tags.map((tag) => String(tag).trim().toLowerCase()).filter(Boolean);
    if (wanted.length === 0) return [];
    const requiredAll = match === "all";
    return this._getRecommendedArtists().filter((artist) => {
      const artistTags = Array.isArray(artist.tags)
        ? artist.tags.map((t) => String(t).toLowerCase())
        : [];
      if (requiredAll) {
        return wanted.every((tag) => artistTags.includes(tag));
      }
      return wanted.some((tag) => artistTags.includes(tag));
    });
  }

  _filterTracksByArtists(tracks, includeSet, excludeSet) {
    return (tracks || []).filter((track) => {
      const artistKey = this._trackArtistKey(track);
      if (!artistKey) return false;
      if (excludeSet?.has(artistKey)) return false;
      if (includeSet && includeSet.size > 0 && !includeSet.has(artistKey))
        return false;
      return true;
    });
  }

  _filterArtistsByKeySet(artists, excludeSet) {
    if (!Array.isArray(artists) || artists.length === 0 || !excludeSet?.size) {
      return Array.isArray(artists) ? artists : [];
    }
    return artists.filter((artist) => {
      const keys = this._artistKeysFromArtist(artist);
      return !keys.some((key) => excludeSet.has(key));
    });
  }

  async _getLibraryArtistKeySet() {
    const { libraryManager } = await import("./libraryManager.js");
    const artists = await libraryManager.getAllArtists();
    const set = new Set();
    for (const artist of artists) {
      for (const key of this._artistKeysFromArtist(artist)) {
        set.add(key);
      }
    }
    return set;
  }

  async _getTopTrackForArtist(artistName, options = {}) {
    const name = String(artistName || "").trim();
    if (!name) return null;
    const deepDive = options?.deepDive === true;
    const ranges = deepDive
      ? [
          { start: 9, end: 24 },
          { start: 0, end: 9 },
          { start: 0, end: Number.MAX_SAFE_INTEGER },
        ]
      : [
          { start: 0, end: 9 },
          { start: 0, end: Number.MAX_SAFE_INTEGER },
        ];
    const topTracks = await lastfmRequest("artist.getTopTracks", {
      artist: name,
      limit: 25,
    });
    const trackList = topTracks?.toptracks?.track
      ? Array.isArray(topTracks.toptracks.track)
        ? topTracks.toptracks.track
        : [topTracks.toptracks.track]
      : [];
    const pick = this._pickTrackFromRanges(trackList, ranges);
    const trackName = pick?.name?.trim();
    if (!trackName) return null;
    return this._buildTrackEntry({
      artistName: name,
      trackName,
      albumName: pick?.album?.title || pick?.album?.["#text"] || null,
      reason: options?.reason || "Flow selection",
    });
  }

  async _getTracksForArtists(artistNames, limit, options = {}) {
    if (!getLastfmApiKey()) {
      throw new Error("Last.fm API key not configured");
    }
    if (!Array.isArray(artistNames) || artistNames.length === 0) return [];
    const shuffled = [...artistNames].sort(() => 0.5 - Math.random());
    const tracks = [];
    const seen = new Set();
    for (const name of shuffled) {
      if (tracks.length >= limit) break;
      try {
        const track = await this._getTopTrackForArtist(name, options);
        if (!track) continue;
        const key = this._trackArtistKey(track);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        tracks.push(track);
      } catch {
        continue;
      }
    }
    return tracks;
  }

  async _getTracksForRankedArtists(artists, limit, options = {}) {
    if (!getLastfmApiKey()) {
      throw new Error("Last.fm API key not configured");
    }
    if (!Array.isArray(artists) || artists.length === 0 || limit <= 0) return [];
    const tracks = [];
    const seen = new Set();
    for (const entry of artists) {
      if (tracks.length >= limit) break;
      const artistName =
        typeof entry === "string"
          ? String(entry).trim()
          : String(entry?.name || entry?.artistName || "").trim();
      if (!artistName) continue;
      const key = this._artistKey(artistName);
      if (!key || seen.has(key)) continue;
      if (options?.excludeArtistKeys?.has(key)) continue;
      try {
        const track = await this._getTopTrackForArtist(artistName, options);
        if (!track) continue;
        seen.add(key);
        tracks.push(track);
      } catch {
        continue;
      }
    }
    return this._filterTracksByArtists(
      this._filterTracksByBlocklist(tracks, options?.blocklist),
      null,
      options?.excludeArtistKeys,
    );
  }

  async _getTagArtists(tag, limit) {
    if (!getLastfmApiKey()) {
      throw new Error("Last.fm API key not configured");
    }
    if (!tag || limit <= 0) return [];
    const data = await lastfmRequest("tag.getTopArtists", {
      tag,
      limit,
    });
    if (!data?.topartists?.artist) return [];
    const artists = Array.isArray(data.topartists.artist)
      ? data.topartists.artist
      : [data.topartists.artist];
    return artists
      .map((artist) => String(artist?.name || "").trim())
      .filter(Boolean);
  }

  async _getSimilarArtists(artistKey, limit = 25) {
    if (!getLastfmApiKey()) {
      throw new Error("Last.fm API key not configured");
    }
    if (!artistKey || limit <= 0) return [];
    const params = this._isMbid(artistKey)
      ? { mbid: artistKey, limit }
      : { artist: artistKey, limit };
    const similar = await lastfmRequest("artist.getSimilar", params);
    return similar?.similarartists?.artist
      ? Array.isArray(similar.similarartists.artist)
        ? similar.similarartists.artist
        : [similar.similarartists.artist]
      : [];
  }

  _buildRankedArtistPool(groups) {
    const scoreMap = new Map();
    for (const group of Array.isArray(groups) ? groups : []) {
      const seenInGroup = new Set();
      for (const artist of Array.isArray(group?.artists) ? group.artists : []) {
        const artistName =
          typeof artist === "string"
            ? String(artist).trim()
            : String(artist?.name || artist?.artistName || "").trim();
        const key = this._artistKey(artistName);
        if (!key || seenInGroup.has(key)) continue;
        seenInGroup.add(key);
        const current = scoreMap.get(key) || {
          name: artistName,
          score: 0,
          rankSum: 0,
        };
        current.score += 1;
        current.rankSum += seenInGroup.size;
        if (!current.name) current.name = artistName;
        scoreMap.set(key, current);
      }
    }
    return [...scoreMap.values()]
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (a.rankSum !== b.rankSum) return a.rankSum - b.rankSum;
        return a.name.localeCompare(b.name);
      });
  }

  async _getTieredGroupTracks(groups, limit, options = {}) {
    if (!Array.isArray(groups) || groups.length === 0 || limit <= 0) return [];
    const rankedArtists = this._buildRankedArtistPool(groups);
    if (rankedArtists.length === 0) return [];
    const maxScore = rankedArtists.reduce(
      (highest, entry) => Math.max(highest, Number(entry?.score || 0)),
      0,
    );
    if (maxScore <= 0) return [];
    const picked = [];
    const used = new Set();
    for (let score = maxScore; score >= 1 && picked.length < limit; score -= 1) {
      const tierArtists = rankedArtists
        .filter((entry) => Number(entry?.score || 0) === score)
        .map((entry) => entry.name)
        .filter(Boolean);
      if (tierArtists.length === 0) continue;
      const remaining = limit - picked.length;
      const tierTracks = await this._getTracksForRankedArtists(
        tierArtists,
        remaining,
        options,
      ).catch(() => []);
      for (const track of tierTracks) {
        if (picked.length >= limit) break;
        const key = this._trackArtistKey(track);
        if (!key || used.has(key)) continue;
        used.add(key);
        picked.push(track);
      }
    }
    return picked;
  }

  async getTagGroupTracks(tagsMap, limit, options = {}) {
    const tags = Object.keys(this._normalizeWeightMap(tagsMap));
    if (tags.length === 0 || limit <= 0) return [];
    if (tags.length === 1) {
      return this.getTagTracks(tags[0], limit, options);
    }
    const requestedArtists = Math.max(limit * 6, 100);
    const groups = await Promise.all(
      tags.map(async (tag) => ({
        tag,
        artists: await this._getTagArtists(tag, requestedArtists).catch(() => []),
      })),
    );
    return this._getTieredGroupTracks(
      groups,
      limit,
      {
        deepDive: options?.deepDive === true,
        reason: options?.reason || `From genres: ${tags.join(", ")}`,
        blocklist: options?.blocklist,
        excludeArtistKeys: options?.excludeArtistKeys,
      },
    ).catch(() => []);
  }

  async getRelatedArtistGroupTracks(relatedArtistsMap, limit, options = {}) {
    const artists = Object.keys(this._normalizeWeightMap(relatedArtistsMap));
    if (artists.length === 0 || limit <= 0) return [];
    if (artists.length === 1) {
      return this.getRelatedArtistTracks(artists[0], limit, options);
    }
    const groups = await Promise.all(
      artists.map(async (artist) => ({
        artist,
        artists: await this._getSimilarArtists(artist, 75).catch(() => []),
      })),
    );
    return this._getTieredGroupTracks(
      groups,
      limit,
      {
        deepDive: options?.deepDive === true,
        reason: options?.reason || `Similar to ${artists.join(", ")}`,
        blocklist: options?.blocklist,
        excludeArtistKeys: options?.excludeArtistKeys,
      },
    ).catch(() => []);
  }

  _buildWeightedSourceCounts(total, sources) {
    const items = sources.filter(
      (source) => Number.isFinite(source.weight) && source.weight > 0,
    );
    if (total <= 0 || items.length === 0) return [];
    const sum = items.reduce((acc, item) => acc + item.weight, 0);
    if (!Number.isFinite(sum) || sum <= 0) return [];
    const scaled = items.map((item) => ({
      ...item,
      raw: (item.weight / sum) * total,
    }));
    const floored = scaled.map((item) => ({
      ...item,
      count: Math.floor(item.raw),
      remainder: item.raw - Math.floor(item.raw),
    }));
    let remaining = total - floored.reduce((acc, item) => acc + item.count, 0);
    const ordered = [...floored].sort((a, b) => b.remainder - a.remainder);
    for (let i = 0; i < ordered.length && remaining > 0; i++) {
      ordered[i].count += 1;
      remaining -= 1;
    }
    return ordered;
  }

  _isMbid(value) {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      value,
    );
  }

  _sliceRange(trackList, start, end) {
    if (!Array.isArray(trackList) || trackList.length === 0) return [];
    if (start >= trackList.length) return [];
    const safeStart = Math.max(0, start);
    const safeEnd = Math.min(trackList.length - 1, end);
    if (safeEnd < safeStart) return [];
    return trackList.slice(safeStart, safeEnd + 1);
  }

  _pickRandomTrack(trackList) {
    if (!Array.isArray(trackList) || trackList.length === 0) return null;
    return trackList
      .filter((track) => String(track?.name || "").trim().length > 0)
      .sort((left, right) => {
        const leftAlbum = String(
          left?.album?.title || left?.album?.["#text"] || "",
        ).trim();
        const rightAlbum = String(
          right?.album?.title || right?.album?.["#text"] || "",
        ).trim();
        if (Boolean(rightAlbum) !== Boolean(leftAlbum)) {
          return Number(Boolean(rightAlbum)) - Number(Boolean(leftAlbum));
        }
        const leftPlaycount = Number(left?.playcount || left?.listeners || 0);
        const rightPlaycount = Number(right?.playcount || right?.listeners || 0);
        if (rightPlaycount !== leftPlaycount) {
          return rightPlaycount - leftPlaycount;
        }
        return String(left?.name || "").localeCompare(String(right?.name || ""));
      })[0] || null;
  }

  _pickTrackFromRanges(trackList, ranges) {
    for (const range of ranges) {
      const candidates = this._sliceRange(
        trackList,
        range.start,
        range.end,
      ).filter((track) => String(track?.name || "").trim().length > 0);
      const pick = this._pickRandomTrack(candidates);
      if (pick) return pick;
    }
    return null;
  }

  _pickTrackFromRangesWithOwned(trackList, ownedTitles, ranges) {
    for (const range of ranges) {
      const candidates = this._sliceRange(
        trackList,
        range.start,
        range.end,
      ).filter((track) => {
        const name = String(track?.name || "")
          .trim()
          .toLowerCase();
        return name && !ownedTitles.has(name);
      });
      const pick = this._pickRandomTrack(candidates);
      if (pick) return pick;
    }
    return null;
  }

  async _pickTrackFromRangesWithOwnedAlbums(
    trackList,
    ownedTitles,
    ownedAlbums,
    artistName,
    ranges,
  ) {
    let checked = 0;
    const maxChecks = 12;
    for (const range of ranges) {
      const candidates = this._sliceRange(
        trackList,
        range.start,
        range.end,
      ).filter((track) => {
        const name = String(track?.name || "")
          .trim()
          .toLowerCase();
        return name && !ownedTitles.has(name);
      });
      const shuffled = [...candidates].sort(() => 0.5 - Math.random());
      for (const candidate of shuffled) {
        if (checked >= maxChecks) return null;
        checked += 1;
        const trackName = String(candidate?.name || "").trim();
        if (!trackName) continue;
        try {
          const info = await lastfmRequest("track.getInfo", {
            artist: artistName,
            track: trackName,
            autocorrect: 1,
          });
          const albumTitle = String(info?.track?.album?.title || "")
            .trim()
            .toLowerCase();
          if (!albumTitle) continue;
          if (!ownedAlbums.has(albumTitle)) {
            return {
              pick: candidate,
              albumName:
                String(info?.track?.album?.title || "").trim() || null,
            };
          }
        } catch {
          continue;
        }
      }
    }
    return null;
  }

  _dedupeAndFill(size, sources, counts) {
    const seen = new Set();
    const picked = [];
    const indices = {
      discover: 0,
      mix: 0,
      trending: 0,
    };

    const takeFrom = (type, count) => {
      const list = sources[type] || [];
      let added = 0;
      while (indices[type] < list.length && added < count) {
        const track = list[indices[type]];
        indices[type] += 1;
        const key = this._trackArtistKey(track);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        picked.push(track);
        added += 1;
      }
    };

    takeFrom("discover", counts.discover || 0);
    takeFrom("mix", counts.mix || 0);
    takeFrom("trending", counts.trending || 0);

    const order = ["discover", "mix", "trending"];
    let looped = false;
    while (picked.length < size) {
      let progress = false;
      for (const type of order) {
        const list = sources[type] || [];
        while (indices[type] < list.length) {
          const track = list[indices[type]];
          indices[type] += 1;
          const key = this._trackArtistKey(track);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          picked.push(track);
          progress = true;
          break;
        }
        if (picked.length >= size) break;
      }
      if (!progress) {
        if (looped) break;
        looped = true;
      } else {
        looped = false;
      }
    }

    return picked.slice(0, size);
  }

  _dedupeAndFillSources(size, sources) {
    const seen = new Set();
    const picked = [];
    const indices = new Map();
    for (const source of sources) {
      indices.set(source.key, 0);
    }

    const takeFrom = (source) => {
      const list = source.tracks || [];
      let added = 0;
      let index = indices.get(source.key) || 0;
      while (index < list.length && added < source.count) {
        const track = list[index];
        index += 1;
        const key = this._trackArtistKey(track);
        if (!key || seen.has(key)) continue;
        seen.add(key);
        picked.push(track);
        added += 1;
      }
      indices.set(source.key, index);
    };

    for (const source of sources) {
      takeFrom(source);
    }

    let looped = false;
    while (picked.length < size) {
      let progress = false;
      for (const source of sources) {
        const list = source.tracks || [];
        let index = indices.get(source.key) || 0;
        while (index < list.length) {
          const track = list[index];
          index += 1;
          const key = this._trackArtistKey(track);
          if (!key || seen.has(key)) continue;
          seen.add(key);
          picked.push(track);
          progress = true;
          break;
        }
        indices.set(source.key, index);
        if (picked.length >= size) break;
      }
      if (!progress) {
        if (looped) break;
        looped = true;
      } else {
        looped = false;
      }
    }

    return picked.slice(0, size);
  }

  async getCuratedDiscoverTracks(limit, options = {}) {
    const tags = options?.tags || {};
    const relatedArtists = options?.relatedArtists || {};
    const deepDive = options?.deepDive === true;
    const sources = [];

    for (const [tag, weight] of Object.entries(tags)) {
      sources.push({ type: "tag", key: tag, weight: Number(weight) });
    }
    for (const [artist, weight] of Object.entries(relatedArtists)) {
      sources.push({ type: "related", key: artist, weight: Number(weight) });
    }

    if (sources.length === 0) {
      return await this.getDiscoverTracks(limit, {
        deepDive,
        blocklist: options?.blocklist,
      });
    }

    if (!getLastfmApiKey()) {
      throw new Error("Last.fm API key required for curated discovery");
    }

    const counts = this._buildWeightedSourceCounts(limit, sources);
    const curated = [];
    for (const source of counts) {
      if (!source.count) continue;
      try {
        if (source.type === "tag") {
          const tracks = await this.getTagTracks(source.key, source.count, {
            reason: `From genre: ${source.key}`,
            blocklist: options?.blocklist,
          });
          curated.push(...tracks);
        } else {
          const tracks = await this.getRelatedArtistTracks(
            source.key,
            source.count,
            {
              deepDive,
              reason: `Similar to ${source.key}`,
              blocklist: options?.blocklist,
            },
          );
          curated.push(...tracks);
        }
      } catch {
        continue;
      }
    }

    if (curated.length >= limit) {
      return curated.slice(0, limit);
    }

    const fallback = await this.getDiscoverTracks(limit - curated.length, {
      deepDive,
      blocklist: options?.blocklist,
    }).catch(() => []);
    return [...curated, ...fallback];
  }

  async _getArtistTopTags(artistName, artistMbid = null) {
    const name = String(artistName || "").trim();
    const mbid = String(artistMbid || "").trim();
    const cacheKey = mbid || this._artistKey(name);
    if (!cacheKey) return [];
    if (this.artistTopTagsCache.has(cacheKey)) {
      return this.artistTopTagsCache.get(cacheKey);
    }
    const promise = (async () => {
      if (!getLastfmApiKey()) return [];
      const params = mbid ? { mbid, limit: 12 } : { artist: name, limit: 12 };
      try {
        const data = await lastfmRequest("artist.getTopTags", params);
        const list = data?.toptags?.tag
          ? Array.isArray(data.toptags.tag)
            ? data.toptags.tag
            : [data.toptags.tag]
          : [];
        const seen = new Set();
        const tags = [];
        for (const entry of list) {
          const tag = String(entry?.name || "").trim();
          const key = this._artistKey(tag);
          if (!tag || !key || seen.has(key)) continue;
          seen.add(key);
          tags.push(tag);
          if (tags.length >= 12) break;
        }
        return tags;
      } catch {
        return [];
      }
    })();
    this.artistTopTagsCache.set(cacheKey, promise);
    const tags = await promise;
    this.artistTopTagsCache.set(cacheKey, tags);
    return tags;
  }

  async _buildRelatedArtistMatchMap(seedArtists) {
    const normalizedSeeds = this._normalizeFocusEntries(seedArtists);
    const cacheKey = normalizedSeeds.map((entry) => this._artistKey(entry)).join("\u0001");
    if (!cacheKey) return new Map();
    if (this.relatedArtistMatchCache.has(cacheKey)) {
      return this.relatedArtistMatchCache.get(cacheKey);
    }
    const promise = (async () => {
      const matchMap = new Map();
      for (const seed of normalizedSeeds) {
        const seedKey = this._artistKey(seed);
        if (seedKey) {
          matchMap.set(seedKey, {
            count: normalizedSeeds.length,
            seeds: new Set([seedKey]),
          });
        }
        const similarArtists = await this._getSimilarArtists(seed, 75).catch(() => []);
        for (const artist of similarArtists) {
          const artistName = String(artist?.name || artist?.artistName || "").trim();
          const key = this._artistKey(artistName);
          if (!key) continue;
          const current = matchMap.get(key) || {
            count: 0,
            seeds: new Set(),
          };
          current.seeds.add(seedKey);
          current.count = Math.max(current.count, current.seeds.size);
          matchMap.set(key, current);
        }
      }
      return matchMap;
    })();
    this.relatedArtistMatchCache.set(cacheKey, promise);
    const resolved = await promise;
    this.relatedArtistMatchCache.set(cacheKey, resolved);
    return resolved;
  }

  _buildBaseCandidate(track, source, sourceRank = 0, extra = {}) {
    const artistKey = this._trackArtistKey(track);
    const trackKey = `${artistKey || ""}::${String(track?.trackName || "")
      .trim()
      .toLowerCase()}`;
    const metadataConfidence =
      (track?.albumName ? 0.45 : 0) +
      (track?.releaseYear ? 0.2 : 0) +
      (track?.durationMs ? 0.25 : 0) +
      (track?.trackMbid ? 0.1 : 0);
    const sourceBaseScore = Math.max(0, 200 - sourceRank);
    const downloadabilityHint =
      metadataConfidence * 10 + (track?.artistMbid ? 4 : 0) + (track?.trackMbid ? 4 : 0);
    return {
      ...track,
      source,
      sourceRank,
      trackKey,
      artistTags: Array.isArray(extra.artistTags) ? extra.artistTags : [],
      tagCoverage: Number(extra.tagCoverage || 0),
      tagCoverageRatio: Number(extra.tagCoverageRatio || 0),
      relatedCoverage: Number(extra.relatedCoverage || 0),
      relatedCoverageRatio: Number(extra.relatedCoverageRatio || 0),
      focusTier: extra.focusTier || "none",
      focusPriority: Number(extra.focusPriority || 0),
      metadataConfidence,
      downloadabilityHint,
      finalScore:
        Number(extra.finalScore) ||
        sourceBaseScore + metadataConfidence * 25 + downloadabilityHint,
    };
  }

  _getFocusTierDetails(tagCoverage, totalTags, relatedCoverage, totalRelated) {
    const safeTagCoverage = Number(tagCoverage || 0);
    const safeRelatedCoverage = Number(relatedCoverage || 0);
    const hasTags = totalTags > 0;
    const hasRelated = totalRelated > 0;
    if (!hasTags && !hasRelated) {
      return {
        focusTier: "none",
        focusPriority: 0,
        tagCoverageRatio: 0,
        relatedCoverageRatio: 0,
      };
    }
    const tagCoverageRatio = hasTags
      ? Math.min(1, safeTagCoverage / totalTags)
      : 0;
    const relatedCoverageRatio = hasRelated
      ? Math.min(1, safeRelatedCoverage / totalRelated)
      : 0;

    if (hasTags && hasRelated) {
      if (safeRelatedCoverage >= totalRelated && safeTagCoverage >= totalTags) {
        return {
          focusTier: "both_all",
          focusPriority: 8,
          tagCoverageRatio,
          relatedCoverageRatio,
        };
      }
      if (safeRelatedCoverage >= totalRelated && safeTagCoverage > 0) {
        return {
          focusTier: "both_partial",
          focusPriority: 7,
          tagCoverageRatio,
          relatedCoverageRatio,
        };
      }
      if (safeRelatedCoverage > 0 && safeTagCoverage >= totalTags) {
        return {
          focusTier: "both_partial",
          focusPriority: 6,
          tagCoverageRatio,
          relatedCoverageRatio,
        };
      }
      if (safeRelatedCoverage > 0 && safeTagCoverage > 0) {
        return {
          focusTier: "both_partial",
          focusPriority: 5,
          tagCoverageRatio,
          relatedCoverageRatio,
        };
      }
      if (safeRelatedCoverage >= totalRelated) {
        return {
          focusTier: "related_all_only",
          focusPriority: 4,
          tagCoverageRatio,
          relatedCoverageRatio,
        };
      }
      if (safeRelatedCoverage > 0) {
        return {
          focusTier: "related_partial_only",
          focusPriority: 3,
          tagCoverageRatio,
          relatedCoverageRatio,
        };
      }
      if (safeTagCoverage >= totalTags) {
        return {
          focusTier: "tag_all_only",
          focusPriority: 2,
          tagCoverageRatio,
          relatedCoverageRatio,
        };
      }
      if (safeTagCoverage > 0) {
        return {
          focusTier: "tag_partial_only",
          focusPriority: 1,
          tagCoverageRatio,
          relatedCoverageRatio,
        };
      }
      return {
        focusTier: "none",
        focusPriority: 0,
        tagCoverageRatio,
        relatedCoverageRatio,
      };
    }

    if (hasRelated) {
      return {
        focusTier:
          safeRelatedCoverage >= totalRelated
            ? "related_all_only"
            : safeRelatedCoverage > 0
              ? "related_partial_only"
              : "none",
        focusPriority:
          safeRelatedCoverage >= totalRelated ? 4 : safeRelatedCoverage > 0 ? 3 : 0,
        tagCoverageRatio,
        relatedCoverageRatio,
      };
    }

    return {
      focusTier:
        safeTagCoverage >= totalTags
          ? "tag_all_only"
          : safeTagCoverage > 0
            ? "tag_partial_only"
            : "none",
      focusPriority:
        safeTagCoverage >= totalTags ? 2 : safeTagCoverage > 0 ? 1 : 0,
      tagCoverageRatio,
      relatedCoverageRatio,
    };
  }

  async _buildFocusArtistPool(tags, relatedArtists, limit, options = {}) {
    const normalizedTags = this._normalizeFocusEntries(tags);
    const normalizedRelated = this._normalizeFocusEntries(relatedArtists);
    const totalTags = normalizedTags.length;
    const totalRelated = normalizedRelated.length;
    if (limit <= 0 || (totalTags === 0 && totalRelated === 0)) {
      return [];
    }

    const excludeArtistKeys = options?.excludeArtistKeys || new Set();
    const requestedArtists = Math.min(150, Math.max(limit * 6, 60));
    const candidateMap = new Map();
    const ensureEntry = (artistName, mbid = null) => {
      const name = String(artistName || "").trim();
      const key = this._artistKey(name);
      if (!name || !key || excludeArtistKeys.has(key)) return null;
      let entry = candidateMap.get(key);
      if (!entry) {
        entry = {
          key,
          name,
          artistMbid: String(mbid || "").trim() || null,
          tagMatches: new Set(),
          relatedSeeds: new Set(),
          tagRankSum: 0,
          relatedRankSum: 0,
          popularityHint: 0,
        };
        candidateMap.set(key, entry);
      } else if (!entry.artistMbid && mbid) {
        entry.artistMbid = String(mbid || "").trim() || null;
      }
      return entry;
    };

    const [tagGroups, relatedGroups] = await Promise.all([
      Promise.all(
        normalizedTags.map(async (tag) => ({
          tag,
          artists: await this._getTagArtists(tag, requestedArtists).catch(() => []),
        })),
      ),
      Promise.all(
        normalizedRelated.map(async (seed) => ({
          seed,
          artists: await this._getSimilarArtists(seed, requestedArtists).catch(() => []),
        })),
      ),
    ]);

    for (const group of tagGroups) {
      const tagKey = this._artistKey(group.tag);
      for (let index = 0; index < group.artists.length; index += 1) {
        const entry = ensureEntry(group.artists[index], null);
        if (!entry) continue;
        entry.tagMatches.add(tagKey);
        entry.tagRankSum += index + 1;
      }
    }

    for (const group of relatedGroups) {
      const seedKey = this._artistKey(group.seed);
      for (let index = 0; index < group.artists.length; index += 1) {
        const artist = group.artists[index];
        const artistName = String(artist?.name || artist?.artistName || "").trim();
        const entry = ensureEntry(
          artistName,
          artist?.mbid || artist?.id || artist?.foreignArtistId || null,
        );
        if (!entry) continue;
        entry.relatedSeeds.add(seedKey);
        entry.relatedRankSum += index + 1;
        entry.popularityHint = Math.max(
          entry.popularityHint,
          Math.log10(1 + Math.max(0, Number(artist?.listeners || 0))) +
            Math.max(0, Number(artist?.match || 0)),
        );
      }
    }

    const preliminary = [...candidateMap.values()]
      .sort((left, right) => {
        const leftSignal = left.tagMatches.size + left.relatedSeeds.size;
        const rightSignal = right.tagMatches.size + right.relatedSeeds.size;
        if (rightSignal !== leftSignal) return rightSignal - leftSignal;
        if (right.relatedSeeds.size !== left.relatedSeeds.size) {
          return right.relatedSeeds.size - left.relatedSeeds.size;
        }
        if (right.tagMatches.size !== left.tagMatches.size) {
          return right.tagMatches.size - left.tagMatches.size;
        }
        if (left.relatedRankSum !== right.relatedRankSum) {
          return left.relatedRankSum - right.relatedRankSum;
        }
        if (left.tagRankSum !== right.tagRankSum) {
          return left.tagRankSum - right.tagRankSum;
        }
        return left.name.localeCompare(right.name);
      })
      .slice(0, Math.max(limit * 2, 60));

    const normalizedTagSet = new Set(normalizedTags.map((entry) => this._artistKey(entry)));
    const enriched = await Promise.all(
      preliminary.map(async (artist, index) => {
        const topTags = await this._getArtistTopTags(artist.name, artist.artistMbid);
        const tagMatches = new Set(artist.tagMatches);
        for (const tag of topTags) {
          const tagKey = this._artistKey(tag);
          if (normalizedTagSet.has(tagKey)) {
            tagMatches.add(tagKey);
          }
        }
        const focusDetails = this._getFocusTierDetails(
          tagMatches.size,
          totalTags,
          artist.relatedSeeds.size,
          totalRelated,
        );
        return {
          ...artist,
          sourceRank: index,
          artistTags: topTags,
          tagCoverage: tagMatches.size,
          relatedCoverage: artist.relatedSeeds.size,
          ...focusDetails,
        };
      }),
    );

    return enriched
      .filter((artist) => Number(artist.focusPriority || 0) > 0)
      .sort((left, right) => {
        if (right.focusPriority !== left.focusPriority) {
          return right.focusPriority - left.focusPriority;
        }
        if (right.tagCoverage !== left.tagCoverage) {
          return right.tagCoverage - left.tagCoverage;
        }
        if (right.relatedCoverage !== left.relatedCoverage) {
          return right.relatedCoverage - left.relatedCoverage;
        }
        if (right.popularityHint !== left.popularityHint) {
          return right.popularityHint - left.popularityHint;
        }
        if (left.relatedRankSum !== right.relatedRankSum) {
          return left.relatedRankSum - right.relatedRankSum;
        }
        if (left.tagRankSum !== right.tagRankSum) {
          return left.tagRankSum - right.tagRankSum;
        }
        return left.name.localeCompare(right.name);
      })
      .slice(0, Math.max(limit, 1));
  }

  async _getFocusCandidates(limit, options = {}) {
    const tags = this._normalizeFocusEntries(options?.tags);
    const relatedArtists = this._normalizeFocusEntries(options?.relatedArtists);
    if (limit <= 0 || (tags.length === 0 && relatedArtists.length === 0)) {
      return [];
    }
    const focusArtistPool = await this._buildFocusArtistPool(
      tags,
      relatedArtists,
      Math.min(150, Math.max(limit * 4, 48)),
      options,
    );
    if (focusArtistPool.length === 0) return [];
    const tracks = await this._getTracksForRankedArtists(focusArtistPool, limit, {
      deepDive: options?.deepDive === true,
      reason: "From focus filters",
      blocklist: options?.blocklist,
      excludeArtistKeys: options?.excludeArtistKeys,
    }).catch(() => []);
    const focusArtistMap = new Map(
      focusArtistPool.map((artist) => [this._artistKey(artist.name), artist]),
    );
    return tracks
      .map((track, index) => {
        const artist = focusArtistMap.get(this._trackArtistKey(track));
        if (!artist) return null;
        return this._buildBaseCandidate(track, "focus", index, {
          artistTags: artist.artistTags,
          tagCoverage: artist.tagCoverage,
          tagCoverageRatio: artist.tagCoverageRatio,
          relatedCoverage: artist.relatedCoverage,
          relatedCoverageRatio: artist.relatedCoverageRatio,
          focusTier: artist.focusTier,
          focusPriority: artist.focusPriority,
          finalScore:
            artist.focusPriority * 1000 +
            artist.tagCoverageRatio * 120 +
            artist.relatedCoverageRatio * 140 +
            (artist.popularityHint || 0),
        });
      })
      .filter((candidate) => {
        if (!candidate) return false;
        if (!(options?.excludeTrackKeys instanceof Set)) return true;
        return !options.excludeTrackKeys.has(candidate.trackKey);
      })
      .sort((left, right) => {
        if (right.focusPriority !== left.focusPriority) {
          return right.focusPriority - left.focusPriority;
        }
        if (right.finalScore !== left.finalScore) {
          return right.finalScore - left.finalScore;
        }
        return left.sourceRank - right.sourceRank;
      });
  }

  _sortSourceCandidates(candidates) {
    return [...(Array.isArray(candidates) ? candidates : [])].sort((left, right) => {
      if (right.finalScore !== left.finalScore) {
        return right.finalScore - left.finalScore;
      }
      return left.sourceRank - right.sourceRank;
    });
  }

  _selectFromCandidates(candidates, count, usedArtistKeys) {
    const picked = [];
    for (const candidate of Array.isArray(candidates) ? candidates : []) {
      if (picked.length >= count) break;
      const artistKey = this._trackArtistKey(candidate);
      if (!artistKey || usedArtistKeys.has(artistKey)) continue;
      usedArtistKeys.add(artistKey);
      picked.push(candidate);
    }
    return picked;
  }

  _buildSourceTargets(size, mix) {
    return this._buildCounts(size, mix);
  }

  async buildFlowRunPlan(flow, options = {}) {
    const requestedSize = Number(flow?.size || 0);
    const targetSize =
      Number.isFinite(requestedSize) && requestedSize > 0 ? Math.round(requestedSize) : 30;
    const reserveSize =
      Number.isFinite(Number(options?.reserveSize)) && Number(options.reserveSize) >= 0
        ? Math.round(Number(options.reserveSize))
        : Math.max(Math.ceil(targetSize * 0.75), 8);
    const mix = flow?.mix || { discover: 34, mix: 33, trending: 33, focus: 0 };
    const sourceTargets = this._buildSourceTargets(targetSize, mix);
    const reserveTargets = this._buildSourceTargets(reserveSize, mix);
    const combinedTargets = {
      discover: Number(sourceTargets.discover || 0) + Number(reserveTargets.discover || 0),
      mix: Number(sourceTargets.mix || 0) + Number(reserveTargets.mix || 0),
      trending: Number(sourceTargets.trending || 0) + Number(reserveTargets.trending || 0),
      focus: Number(sourceTargets.focus || 0) + Number(reserveTargets.focus || 0),
    };
    const tags = this._normalizeFocusEntries(flow?.tags);
    const relatedArtists = this._normalizeFocusEntries(flow?.relatedArtists);
    const blocklist = this._getBlocklist();
    const excludeArtistKeys = new Set(
      Array.isArray(options?.excludeArtistKeys) ? options.excludeArtistKeys : options?.excludeArtistKeys || [],
    );
    const excludeTrackKeys = new Set(
      Array.isArray(options?.excludeTrackKeys) ? options.excludeTrackKeys : options?.excludeTrackKeys || [],
    );
    const libraryArtistKeys = await this._getLibraryArtistKeySet().catch(() => new Set());
    const nonLibraryExcludeArtistKeys = new Set(excludeArtistKeys);
    for (const entry of libraryArtistKeys) {
      nonLibraryExcludeArtistKeys.add(entry);
    }
    const harvestLimitFor = (count) =>
      Math.min(150, Math.max(Number(count || 0) * 6, 24));
    const [discoverTracks, mixTracks, trendingTracks, focusCandidates] = await Promise.all([
      combinedTargets.discover > 0
        ? this.getDiscoverTracks(harvestLimitFor(combinedTargets.discover), {
            deepDive: flow?.deepDive === true,
            reason: "From discovery recommendations",
            blocklist,
            excludeArtistKeys: nonLibraryExcludeArtistKeys,
          }).catch(() => [])
        : [],
      combinedTargets.mix > 0
        ? this.getMixTracks(harvestLimitFor(combinedTargets.mix), {
            deepDive: flow?.deepDive === true,
            reason: "From your library mix",
            blocklist,
          }).catch(() => [])
        : [],
      combinedTargets.trending > 0
        ? this.getTrendingTracks(harvestLimitFor(combinedTargets.trending), {
            deepDive: flow?.deepDive === true,
            reason: "From trending artists",
            blocklist,
            excludeArtistKeys: nonLibraryExcludeArtistKeys,
          }).catch(() => [])
        : [],
      combinedTargets.focus > 0
        ? this._getFocusCandidates(harvestLimitFor(combinedTargets.focus), {
            tags,
            relatedArtists,
            deepDive: flow?.deepDive === true,
            blocklist,
            excludeArtistKeys: nonLibraryExcludeArtistKeys,
            excludeTrackKeys,
          }).catch(() => [])
        : [],
    ]);
    const candidateMap = {
      discover: this._sortSourceCandidates(
        discoverTracks
          .map((track, index) => this._buildBaseCandidate(track, "discover", index))
          .filter((candidate) => {
            const artistKey = this._trackArtistKey(candidate);
            return (
              artistKey &&
              !nonLibraryExcludeArtistKeys.has(artistKey) &&
              !excludeTrackKeys.has(candidate.trackKey)
            );
          }),
      ),
      mix: this._sortSourceCandidates(
        mixTracks
          .map((track, index) => this._buildBaseCandidate(track, "mix", index))
          .filter((candidate) => {
            const artistKey = this._trackArtistKey(candidate);
            return artistKey && !excludeArtistKeys.has(artistKey) && !excludeTrackKeys.has(candidate.trackKey);
          }),
      ),
      trending: this._sortSourceCandidates(
        trendingTracks
          .map((track, index) => this._buildBaseCandidate(track, "trending", index))
          .filter((candidate) => {
            const artistKey = this._trackArtistKey(candidate);
            return (
              artistKey &&
              !nonLibraryExcludeArtistKeys.has(artistKey) &&
              !excludeTrackKeys.has(candidate.trackKey)
            );
          }),
      ),
      focus: this._sortSourceCandidates(focusCandidates),
    };
    const orderedSources = ["focus", "mix", "discover", "trending"];
    const usedArtistKeys = new Set(excludeArtistKeys);
    const primaryTracks = [];
    const primaryBySource = {};
    for (const source of orderedSources) {
      const picked = this._selectFromCandidates(
        candidateMap[source],
        Number(sourceTargets[source] || 0),
        usedArtistKeys,
      );
      primaryBySource[source] = picked;
      primaryTracks.push(...picked);
    }
    const remainingPrimaryNeeded = Math.max(0, targetSize - primaryTracks.length);
    if (remainingPrimaryNeeded > 0) {
      const pooled = orderedSources.flatMap((source) => candidateMap[source]);
      primaryTracks.push(
        ...this._selectFromCandidates(pooled, remainingPrimaryNeeded, usedArtistKeys),
      );
    }
    const reserveTracks = [];
    for (const source of orderedSources) {
      const needed = Math.max(0, Number(reserveTargets[source] || 0));
      reserveTracks.push(
        ...this._selectFromCandidates(candidateMap[source], needed, usedArtistKeys),
      );
    }
    const remainingReserveNeeded = Math.max(0, reserveSize - reserveTracks.length);
    if (remainingReserveNeeded > 0) {
      const pooled = orderedSources.flatMap((source) => candidateMap[source]);
      reserveTracks.push(
        ...this._selectFromCandidates(pooled, remainingReserveNeeded, usedArtistKeys),
      );
    }
    const finalPrimary = primaryTracks.slice(0, targetSize).map(({ trackKey, ...track }) => track);
    const finalReserve = reserveTracks.slice(0, reserveSize).map(({ trackKey, ...track }) => track);
    return {
      primaryTracks: finalPrimary,
      reserveTracks: finalReserve,
      diagnostics: {
        requested: {
          size: targetSize,
          reserveSize,
          sources: sourceTargets,
          reserveSources: reserveTargets,
        },
        achieved: {
          primary: finalPrimary.length,
          reserve: finalReserve.length,
          sourceCounts: orderedSources.reduce((acc, source) => {
            acc[source] = finalPrimary.filter((track) => track.source === source).length;
            return acc;
          }, {}),
          reserveSourceCounts: orderedSources.reduce((acc, source) => {
            acc[source] = finalReserve.filter((track) => track.source === source).length;
            return acc;
          }, {}),
          focusTiers: [...finalPrimary, ...finalReserve].reduce((acc, track) => {
            const tier = String(track.focusTier || "none");
            acc[tier] = Number(acc[tier] || 0) + 1;
            return acc;
          }, {}),
        },
      },
    };
  }

  async getTracksForFlow(flow) {
    const plan = await this.buildFlowRunPlan(flow);
    return Array.isArray(plan?.primaryTracks) ? plan.primaryTracks : [];
  }

  async getDiscoverTracks(limit, options = {}) {
    if (!getLastfmApiKey()) {
      throw new Error("Last.fm API key not configured");
    }

    const discoveryCache = getDiscoveryCache();
    const recommendations = this._filterArtistsByBlocklist(
      discoveryCache.recommendations || [],
      options?.blocklist,
    );
    if (!Array.isArray(recommendations) || recommendations.length === 0) {
      throw new Error(
        "No discovery recommendations available. Update discovery cache first.",
      );
    }
    const deepDive = options?.deepDive === true;
    const ranges = deepDive
      ? [
          { start: 9, end: 24 },
          { start: 0, end: 9 },
          { start: 0, end: Number.MAX_SAFE_INTEGER },
        ]
      : [
          { start: 0, end: 9 },
          { start: 0, end: Number.MAX_SAFE_INTEGER },
        ];
    const excludeSet = options?.excludeArtistKeys;
    const shuffled = [...recommendations].sort(() => 0.5 - Math.random());
    const tracks = [];
    const seenArtists = new Set();
    for (const artist of shuffled) {
      if (tracks.length >= limit) break;
      const artistName = (artist?.name || artist?.artistName || "").trim();
      if (!artistName) continue;
      const artistKeys = this._artistKeysFromArtist(artist);
      if (artistKeys.some((key) => excludeSet?.has(key))) continue;
      const artistKey = this._artistKey(artistName);
      if (!artistKey || seenArtists.has(artistKey)) continue;
      try {
        const topTracks = await lastfmRequest("artist.getTopTracks", {
          artist: artistName,
          limit: 25,
        });
        if (!topTracks?.toptracks?.track) continue;
        const trackList = Array.isArray(topTracks.toptracks.track)
          ? topTracks.toptracks.track
          : [topTracks.toptracks.track];
        const pick = this._pickTrackFromRanges(trackList, ranges);
        const trackName = pick?.name?.trim();
        if (!trackName) continue;
        seenArtists.add(artistKey);
        const trackEntry = this._buildTrackEntry({
          artistName,
          trackName,
          albumName: pick?.album?.title || pick?.album?.["#text"] || null,
          artistMbid: artist?.id || artist?.mbid || artist?.foreignArtistId,
          reason: options?.reason || "From discovery recommendations",
        });
        if (trackEntry) tracks.push(trackEntry);
      } catch {
        continue;
      }
    }

    return this._filterTracksByArtists(
      this._filterTracksByBlocklist(tracks, options?.blocklist),
      null,
      excludeSet,
    );
  }

  async getTrendingTracks(limit, options = {}) {
    if (!getLastfmApiKey()) {
      throw new Error("Last.fm API key not configured");
    }
    const discoveryCache = getDiscoveryCache();
    const globalTop = this._filterArtistsByBlocklist(
      discoveryCache.globalTop || [],
      options?.blocklist,
    );
    const candidates = this._filterArtistsByKeySet(
      globalTop,
      options?.excludeArtistKeys,
    );
    if (!Array.isArray(candidates) || candidates.length === 0) {
      throw new Error(
        "No trending artists available. Update discovery cache first.",
      );
    }
    const deepDive = options?.deepDive === true;
    const ranges = deepDive
      ? [
          { start: 9, end: 24 },
          { start: 0, end: 9 },
          { start: 0, end: Number.MAX_SAFE_INTEGER },
        ]
      : [
          { start: 0, end: 9 },
          { start: 0, end: Number.MAX_SAFE_INTEGER },
        ];
    const shuffled = [...candidates].sort(() => 0.5 - Math.random());
    const tracks = [];
    const seenArtists = new Set();
    for (const artist of shuffled) {
      if (tracks.length >= limit) break;
      const artistName = (artist?.name || artist?.artistName || "").trim();
      if (!artistName) continue;
      const artistKey = this._artistKey(artistName);
      if (!artistKey || seenArtists.has(artistKey)) continue;
      try {
        const topTracks = await lastfmRequest("artist.getTopTracks", {
          artist: artistName,
          limit: 25,
        });
        if (!topTracks?.toptracks?.track) continue;
        const trackList = Array.isArray(topTracks.toptracks.track)
          ? topTracks.toptracks.track
          : [topTracks.toptracks.track];
        const pick = this._pickTrackFromRanges(trackList, ranges);
        const trackName = pick?.name?.trim();
        if (!trackName) continue;
        seenArtists.add(artistKey);
        const trackEntry = this._buildTrackEntry({
          artistName,
          trackName,
          albumName: pick?.album?.title || pick?.album?.["#text"] || null,
          artistMbid: artist?.id || artist?.mbid || artist?.foreignArtistId,
          reason: options?.reason || "From trending artists",
        });
        if (trackEntry) tracks.push(trackEntry);
      } catch {
        continue;
      }
    }

    return this._filterTracksByArtists(
      this._filterTracksByBlocklist(tracks, options?.blocklist),
      null,
      options?.excludeArtistKeys,
    );
  }

  async getTagTracks(tag, limit, options = {}) {
    if (!getLastfmApiKey()) {
      throw new Error("Last.fm API key not configured");
    }
    if (!tag || limit <= 0) return [];
    const normalizedTag = this._artistKey(tag);
    if (normalizedTag && this._isTagBlockedByBlocklist([normalizedTag], options?.blocklist)) {
      return [];
    }
    const requested = Math.max(limit * 3, 50);
    const trackData = await lastfmRequest("tag.getTopTracks", {
      tag,
      limit: requested,
    });
    const tracks = trackData?.tracks?.track
      ? Array.isArray(trackData.tracks.track)
        ? trackData.tracks.track
        : [trackData.tracks.track]
      : [];
    const result = [];
    const seen = new Set();
    for (const track of tracks) {
      if (result.length >= limit) break;
      const artistName = (
        track.artist?.name ||
        track.artist?.["#text"] ||
        ""
      ).trim();
      const trackName = track?.name?.trim();
      if (!artistName || !trackName) continue;
      const key = artistName.toLowerCase();
      if (!key || seen.has(key)) continue;
      if (options?.excludeArtistKeys?.has(key)) continue;
      seen.add(key);
      const trackEntry = this._buildTrackEntry({
        artistName,
        trackName,
        albumName: track?.album?.title || track?.album?.["#text"] || null,
        artistMbid: track?.artist?.mbid || null,
        reason: options?.reason || `From genre: ${tag}`,
      });
      if (trackEntry) result.push(trackEntry);
    }
    return this._filterTracksByArtists(
      this._filterTracksByBlocklist(result, options?.blocklist),
      null,
      options?.excludeArtistKeys,
    );
  }

  async getRelatedArtistTracks(artistKey, limit, options = {}) {
    if (!getLastfmApiKey()) {
      throw new Error("Last.fm API key not configured");
    }
    if (!artistKey || limit <= 0) return [];
    const deepDive = options?.deepDive === true;
    const ranges = deepDive
      ? [
          { start: 9, end: 24 },
          { start: 0, end: 9 },
          { start: 0, end: Number.MAX_SAFE_INTEGER },
        ]
      : [
          { start: 0, end: 9 },
          { start: 0, end: Number.MAX_SAFE_INTEGER },
        ];
    const params = this._isMbid(artistKey)
      ? { mbid: artistKey, limit: 25 }
      : { artist: artistKey, limit: 25 };
    const similar = await lastfmRequest("artist.getSimilar", params);
    const list = similar?.similarartists?.artist
      ? Array.isArray(similar.similarartists.artist)
        ? similar.similarartists.artist
        : [similar.similarartists.artist]
      : [];
    const candidates = this._filterArtistsByKeySet(
      list,
      options?.excludeArtistKeys,
    );
    const tracks = [];
    const seenArtists = new Set();
    for (const candidate of candidates) {
      if (tracks.length >= limit) break;
      const artistName = String(candidate?.name || "").trim();
      if (!artistName) continue;
      const key = artistName.toLowerCase();
      if (seenArtists.has(key)) continue;
      seenArtists.add(key);
      try {
        const topTracks = await lastfmRequest("artist.getTopTracks", {
          artist: artistName,
          limit: 25,
        });
        const trackList = topTracks?.toptracks?.track
          ? Array.isArray(topTracks.toptracks.track)
            ? topTracks.toptracks.track
            : [topTracks.toptracks.track]
          : [];
        const pick = this._pickTrackFromRanges(trackList, ranges);
        const trackName = pick?.name?.trim();
        const trackEntry = this._buildTrackEntry({
          artistName,
          trackName,
          albumName: pick?.album?.title || pick?.album?.["#text"] || null,
          artistMbid: candidate?.mbid || null,
          reason: options?.reason || `Similar to ${artistKey}`,
        });
        if (trackEntry) tracks.push(trackEntry);
      } catch {
        continue;
      }
    }
    return this._filterTracksByArtists(
      this._filterTracksByBlocklist(tracks, options?.blocklist),
      null,
      options?.excludeArtistKeys,
    );
  }

  async getRecommendedTracks(limit, options = {}) {
    const discoveryCache = getDiscoveryCache();
    const recommendations = this._filterArtistsByBlocklist(
      discoveryCache.recommendations || [],
      options?.blocklist,
    );
    const globalTop = this._filterArtistsByBlocklist(
      discoveryCache.globalTop || [],
      options?.blocklist,
    );

    if (recommendations.length === 0 && globalTop.length === 0) {
      throw new Error(
        "No discovery recommendations available. Update discovery cache first.",
      );
    }

    const includeGlobalTop = options?.includeGlobalTop !== false;
    const excludeSet = options?.excludeArtistKeys;
    const baseArtists = includeGlobalTop
      ? [...recommendations, ...globalTop]
      : [...recommendations];
    const artists = excludeSet
      ? baseArtists.filter((artist) => {
          const keys = this._artistKeysFromArtist(artist);
          return !keys.some((key) => excludeSet.has(key));
        })
      : baseArtists;

    if (!getLastfmApiKey()) {
      throw new Error("Last.fm API key required for recommended tracks");
    }

    const tracks = [];
    const seenArtists = new Set();
    const deepDive = options?.deepDive === true;
    const ranges = deepDive
      ? [
          { start: 9, end: 24 },
          { start: 0, end: 9 },
          { start: 0, end: Number.MAX_SAFE_INTEGER },
        ]
      : [
          { start: 0, end: 9 },
          { start: 0, end: Number.MAX_SAFE_INTEGER },
        ];
    for (const artist of artists) {
      if (tracks.length >= limit) break;

      const artistName = (artist.name || artist.artistName || "").trim();
      if (!artistName) continue;
      const artistKey = this._artistKey(artistName);
      if (!artistKey || seenArtists.has(artistKey)) continue;

      try {
        const topTracks = await lastfmRequest("artist.getTopTracks", {
          artist: artistName,
          limit: 25,
        });

        if (topTracks?.toptracks?.track) {
          const trackList = Array.isArray(topTracks.toptracks.track)
            ? topTracks.toptracks.track
            : [topTracks.toptracks.track];
          const pick = this._pickTrackFromRanges(trackList, ranges);
          const trackName = pick?.name?.trim();
          if (trackName) {
            seenArtists.add(artistKey);
            const trackEntry = this._buildTrackEntry({
              artistName,
              trackName,
              albumName: pick?.album?.title || pick?.album?.["#text"] || null,
              artistMbid: artist?.id || artist?.mbid || artist?.foreignArtistId,
              reason: options?.reason || "From discovery recommendations",
            });
            if (trackEntry) tracks.push(trackEntry);
          }
        }
      } catch (error) {
        console.warn(
          `[WeeklyFlowPlaylistSource] Failed to get tracks for ${artistName}:`,
          error.message,
        );
      }
    }

    return this._filterTracksByBlocklist(
      tracks.slice(0, limit),
      options?.blocklist,
    );
  }

  async getLibraryTrackTitles(libraryManager, artistId) {
    const albums = await libraryManager.getAlbums(artistId);
    const titles = new Set();
    const maxAlbums = 30;
    for (const album of albums.slice(0, maxAlbums)) {
      const tracks = await libraryManager.getTracks(album.id);
      for (const t of tracks) {
        const name = (t.trackName || t.title || "").trim().toLowerCase();
        if (name) titles.add(name);
      }
    }
    return titles;
  }

  async getLibraryAlbumNames(libraryManager, artistId) {
    const albums = await libraryManager.getAlbums(artistId);
    const names = new Set();
    const maxAlbums = 40;
    for (const album of albums.slice(0, maxAlbums)) {
      const name = (album.albumName || album.title || "").trim().toLowerCase();
      if (name) names.add(name);
    }
    return names;
  }

  async getMixTracks(limit, options = {}) {
    const { libraryManager } = await import("./libraryManager.js");
    const artists = this._filterArtistsByBlocklist(
      await libraryManager.getAllArtists(),
      options?.blocklist,
    );
    if (artists.length === 0) {
      throw new Error("No artists in library. Add artists to enable Mix.");
    }

    if (!getLastfmApiKey()) {
      throw new Error("Last.fm API key required for Mix");
    }

    const shuffled = [...artists].sort(() => 0.5 - Math.random());
    const tracks = [];
    const deepDive = options?.deepDive === true;
    const ranges = deepDive
      ? [
          { start: 9, end: 24 },
          { start: 0, end: 9 },
          { start: 0, end: Number.MAX_SAFE_INTEGER },
        ]
      : [
          { start: 0, end: 9 },
          { start: 0, end: Number.MAX_SAFE_INTEGER },
        ];
    const maxArtistsToTry = Math.min(45, Math.max(limit * 2, 30));

    for (
      let i = 0;
      i < shuffled.length && tracks.length < limit && i < maxArtistsToTry;
      i++
    ) {
      const artist = shuffled[i];
      const artistName = (artist.artistName || artist.name || "").trim();
      if (!artistName) continue;

      try {
        const ownedTitles = await this.getLibraryTrackTitles(
          libraryManager,
          artist.id,
        );
        const ownedAlbums = await this.getLibraryAlbumNames(
          libraryManager,
          artist.id,
        );
        const topTracks = await lastfmRequest("artist.getTopTracks", {
          artist: artistName,
          limit: 25,
        });

        if (!topTracks?.toptracks?.track) continue;

        const trackList = Array.isArray(topTracks.toptracks.track)
          ? topTracks.toptracks.track
          : [topTracks.toptracks.track];

        const picked = await this._pickTrackFromRangesWithOwnedAlbums(
          trackList,
          ownedTitles,
          ownedAlbums,
          artistName,
          ranges,
        );
        const trackName = picked?.pick?.name?.trim();
        const trackEntry = this._buildTrackEntry({
          artistName,
          trackName,
          albumName:
            picked?.albumName ||
            picked?.pick?.album?.title ||
            picked?.pick?.album?.["#text"] ||
            null,
          artistMbid: artist?.mbid || artist?.foreignArtistId || null,
          reason: options?.reason || "From your library mix",
        });
        if (trackEntry) tracks.push(trackEntry);
      } catch (error) {
        console.warn(
          `[WeeklyFlowPlaylistSource] Failed to get Mix tracks for ${artistName}:`,
          error.message,
        );
      }
    }

    return this._filterTracksByBlocklist(tracks, options?.blocklist);
  }
}

export const playlistSource = new WeeklyFlowPlaylistSource();
