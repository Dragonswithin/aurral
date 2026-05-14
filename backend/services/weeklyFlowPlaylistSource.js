import { lastfmRequest, getLastfmApiKey } from "./apiClients.js";
import { getDiscoveryCache } from "./discoveryService.js";
import { dbOps } from "../config/db-helpers.js";

const FLOW_TRACK_FAILURE_BUFFER_RATIO = 0.2;
const MBID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class WeeklyFlowPlaylistSource {
  _buildCounts(size, mix) {
    const weights = [
      { key: "discover", value: Number(mix?.discover ?? 0) },
      { key: "mix", value: Number(mix?.mix ?? 0) },
      { key: "trending", value: Number(mix?.trending ?? 0) },
    ];
    const sum = weights.reduce(
      (acc, w) => acc + (Number.isFinite(w.value) ? w.value : 0),
      0,
    );
    if (sum <= 0 || !Number.isFinite(sum)) {
      return { discover: 0, mix: 0, trending: 0 };
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
    const index = Math.floor(Math.random() * trackList.length);
    return trackList[index] || null;
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

  async getTracksForFlow(flow) {
    const size = Number(flow?.size || 0);
    const limit = Number.isFinite(size) && size > 0 ? size : 30;
    const tags = this._normalizeWeightMap(flow?.tags);
    const relatedArtists = this._normalizeWeightMap(flow?.relatedArtists);
    const focusSettings =
      flow?.focus && typeof flow.focus === "object" ? flow.focus : {};
    const tagStrength = String(focusSettings?.tagStrength || "")
      .trim()
      .toLowerCase();
    const relatedStrength = String(focusSettings?.relatedStrength || "")
      .trim()
      .toLowerCase();
    const tagsTotal = this._sumWeightMap(tags);
    const relatedTotal = this._sumWeightMap(relatedArtists);
    const recipeCounts = this._normalizeRecipeCounts(flow?.recipe);
    const recipeTotal =
      recipeCounts?.discover != null
        ? this._sumWeightMap(recipeCounts)
        : limit;
    const baseTarget = recipeTotal > 0 ? recipeTotal : limit;
    const totalTarget = Math.max(
      1,
      Math.ceil(baseTarget * (1 + FLOW_TRACK_FAILURE_BUFFER_RATIO)),
    );
    if (totalTarget <= 0) return [];
    const counts = (() => {
      if (recipeCounts?.discover == null) {
        return this._buildCounts(totalTarget, flow?.mix);
      }
      const weighted = this._buildWeightedSourceCounts(totalTarget, [
        { key: "discover", weight: Number(recipeCounts.discover || 0) },
        { key: "mix", weight: Number(recipeCounts.mix || 0) },
        { key: "trending", weight: Number(recipeCounts.trending || 0) },
      ]);
      return weighted.reduce((acc, item) => {
        acc[item.key] = Number(item.count || 0);
        return acc;
      }, {});
    })();
    const perTypeLimit = totalTarget > 0 ? Math.max(totalTarget, 30) : 0;
    const blocklist = this._getBlocklist();
    const sourceNeed = {
      discover: Number(counts?.discover || 0) > 0,
      mix: Number(counts?.mix || 0) > 0,
      trending: Number(counts?.trending || 0) > 0,
    };
    const excludeLibraryArtists =
      Number(counts?.mix || 0) <= 0 && Number(flow?.mix?.mix || 0) <= 0;
    const excludedArtistKeys = excludeLibraryArtists
      ? await this._getLibraryArtistKeySet().catch(() => new Set())
      : null;

    const [discoverTracks, mixTracks, trendingTracks] = await Promise.all([
      sourceNeed.discover && perTypeLimit > 0
        ? this.getDiscoverTracks(perTypeLimit, {
            deepDive: flow?.deepDive === true,
            reason: "From discovery recommendations",
            blocklist,
            excludeArtistKeys: excludedArtistKeys,
          }).catch(() => [])
        : [],
      sourceNeed.mix && perTypeLimit > 0
        ? this.getMixTracks(perTypeLimit, {
            deepDive: flow?.deepDive === true,
            reason: "From your library mix",
            blocklist,
          }).catch(() => [])
        : [],
      sourceNeed.trending && perTypeLimit > 0
        ? this.getTrendingTracks(perTypeLimit, {
            deepDive: flow?.deepDive === true,
            reason: "From trending artists",
            blocklist,
            excludeArtistKeys: excludedArtistKeys,
          }).catch(() => [])
        : [],
    ]);
    const getFocusCandidateLimit = (count) =>
      Math.max(
        Number(count || 0),
        Math.min(perTypeLimit, Math.max(Number(count || 0) * 3, 15)),
      );

    const tagSources =
      tagsTotal > 0
        ? [{
            key: "tags",
            count: tagsTotal,
            tracks: await this.getTagGroupTracks(
              tags,
              getFocusCandidateLimit(tagsTotal),
              {
                deepDive: flow?.deepDive === true,
                reason: `From genres: ${Object.keys(tags).join(", ")}`,
                blocklist,
                excludeArtistKeys: excludedArtistKeys,
              },
            ).catch(() => []),
          }]
        : [];
    const relatedSources =
      relatedTotal > 0
        ? [{
            key: "related",
            count: relatedTotal,
            tracks: await this.getRelatedArtistGroupTracks(
              relatedArtists,
              getFocusCandidateLimit(relatedTotal),
              {
                deepDive: flow?.deepDive === true,
                reason: `Similar to ${Object.keys(relatedArtists).join(", ")}`,
                blocklist,
                excludeArtistKeys: excludedArtistKeys,
              },
            ).catch(() => []),
          }]
        : [];
    const focusTotal = Math.min(tagsTotal + relatedTotal, totalTarget);
    const forceFocusedOnly =
      (tagsTotal > 0 && tagStrength === "heavy") ||
      (relatedTotal > 0 && relatedStrength === "heavy");
    const focusTracks =
      focusTotal > 0
        ? this._dedupeAndFillSources(focusTotal, [
            ...tagSources,
            ...relatedSources,
          ])
        : [];
    const focusCounts = this._buildWeightedSourceCounts(focusTotal, [
      { key: "discover", weight: Number(counts.discover || 0) },
      { key: "mix", weight: Number(counts.mix || 0) },
      { key: "trending", weight: Number(counts.trending || 0) },
    ]);
    const orderedKeys = ["discover", "mix", "trending"];
    const focusCountMap = focusCounts.reduce((acc, item) => {
      acc[item.key] = item.count;
      return acc;
    }, {});
    const sourceTracksMap = {
      discover: discoverTracks,
      mix: mixTracks,
      trending: trendingTracks,
    };
    const trackKey = (track) => this._trackArtistKey(track);
    const focusKeySet = new Set(
      focusTracks.map((track) => trackKey(track)).filter(Boolean),
    );
    const focusBuckets = orderedKeys.reduce((acc, key) => {
      const list = sourceTracksMap[key] || [];
      acc[key] = list.filter((track) => focusKeySet.has(trackKey(track)));
      return acc;
    }, {});
    const focusAssignments = {};
    const focusShortfalls = {};
    const usedFocusKeys = new Set();
    for (const key of orderedKeys) {
      const desired = Number(focusCountMap[key] || 0);
      const candidates = focusBuckets[key] || [];
      const picked = [];
      for (const track of candidates) {
        if (picked.length >= desired) break;
        const keyValue = trackKey(track);
        if (!keyValue || usedFocusKeys.has(keyValue)) continue;
        usedFocusKeys.add(keyValue);
        picked.push(track);
      }
      focusAssignments[key] = picked;
      focusShortfalls[key] = Math.max(desired - picked.length, 0);
    }
    const remainingFocusPool = focusTracks.filter(
      (track) => !usedFocusKeys.has(trackKey(track)),
    );
    for (const key of orderedKeys) {
      const shortfall = focusShortfalls[key] || 0;
      if (shortfall <= 0) continue;
      const picked = focusAssignments[key] || [];
      while (picked.length < (focusCountMap[key] || 0) && remainingFocusPool.length > 0) {
        const nextTrack = remainingFocusPool.shift();
        const keyValue = trackKey(nextTrack);
        if (!keyValue || usedFocusKeys.has(keyValue)) continue;
        usedFocusKeys.add(keyValue);
        picked.push(nextTrack);
      }
      focusAssignments[key] = picked;
    }
    const focusSlices = orderedKeys.map((key) => {
      const tracks = focusAssignments[key] || [];
      return { key: `focus:${key}`, count: tracks.length, tracks };
    });
    if (forceFocusedOnly && focusSlices.some((slice) => slice.count > 0)) {
      return this._dedupeAndFillSources(totalTarget, focusSlices);
    }
    const baseSources = orderedKeys.map((key) => {
      const focusCount = focusAssignments[key]?.length || 0;
      const count = Math.max(Number(counts[key] || 0) - focusCount, 0);
      const list = sourceTracksMap[key] || [];
      const tracks = list.filter((track) => !usedFocusKeys.has(trackKey(track)));
      return { key, count, tracks };
    });

    return this._dedupeAndFillSources(totalTarget, [
      ...focusSlices,
      ...baseSources,
    ]);
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
