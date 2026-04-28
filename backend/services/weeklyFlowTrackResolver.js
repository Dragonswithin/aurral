import {
  lastfmRequest,
  musicbrainzRequest,
  musicbrainzResolveArtistMbidByName,
} from "./apiClients.js";

const artistAliasCache = new Map();
const releaseGroupSearchCache = new Map();
const releaseContextCache = new Map();

function escapeMbQuery(value) {
  return String(value || "")
    .trim()
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
}

function normalizeText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(
      /\b(deluxe|expanded|anniversary|remaster(?:ed)?|bonus|edition|live|mono|stereo|single|ep)\b/g,
      " ",
    )
    .replace(/\(.*?\)|\[.*?\]/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getYear(value) {
  const match = String(value || "").match(/\b(19\d{2}|20\d{2})\b/);
  return match ? match[1] : null;
}

function splitWords(value) {
  return normalizeText(value)
    .split(" ")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function scoreTextMatch(left, right) {
  const a = normalizeText(left);
  const b = normalizeText(right);
  if (!a || !b) return 0;
  if (a === b) return 100;
  if (a.includes(b) || b.includes(a)) return 92;
  const leftWords = new Set(splitWords(a));
  const rightWords = new Set(splitWords(b));
  if (leftWords.size === 0 || rightWords.size === 0) return 0;
  let overlap = 0;
  for (const word of leftWords) {
    if (rightWords.has(word)) overlap += 1;
  }
  const ratio =
    (2 * overlap) / Math.max(1, leftWords.size + rightWords.size);
  return Math.round(ratio * 100);
}

function pickBestCandidate(candidates, expectedTitle, expectedYear = null) {
  const list = Array.isArray(candidates) ? candidates : [];
  if (list.length === 0) return null;
  const targetYear = getYear(expectedYear);
  return [...list]
    .map((candidate) => {
      const title =
        candidate?.title ||
        candidate?.["title"] ||
        candidate?.["release-group"]?.title ||
        "";
      const year =
        candidate?.["first-release-date"] ||
        candidate?.date ||
        candidate?.["release-group"]?.["first-release-date"] ||
        null;
      const titleScore = scoreTextMatch(title, expectedTitle);
      const yearScore =
        targetYear && getYear(year) === targetYear
          ? 10
          : targetYear && getYear(year)
            ? -5
            : 0;
      return {
        candidate,
        score: titleScore + yearScore,
      };
    })
    .sort((left, right) => right.score - left.score)[0]?.candidate;
}

async function fetchArtistAliases(artistMbid) {
  const key = String(artistMbid || "").trim();
  if (!key) return [];
  if (artistAliasCache.has(key)) {
    return artistAliasCache.get(key);
  }
  const promise = (async () => {
    try {
      const data = await musicbrainzRequest(`/artist/${key}`, { inc: "aliases" });
      const aliases = Array.isArray(data?.aliases)
        ? data.aliases
            .map((entry) => String(entry?.name || "").trim())
            .filter(Boolean)
        : [];
      return [...new Set(aliases)].slice(0, 8);
    } catch {
      return [];
    }
  })();
  artistAliasCache.set(key, promise);
  const aliases = await promise;
  artistAliasCache.set(key, aliases);
  return aliases;
}

async function resolveReleaseGroup(artistName, artistMbid, albumName, releaseYear) {
  const safeAlbum = String(albumName || "").trim();
  if (!safeAlbum) return null;
  const safeArtist = String(artistName || "").trim();
  const safeMbid = String(artistMbid || "").trim();
  const cacheKey = JSON.stringify([safeArtist, safeMbid, safeAlbum]);
  if (releaseGroupSearchCache.has(cacheKey)) {
    return releaseGroupSearchCache.get(cacheKey);
  }
  const promise = (async () => {
    const escapedAlbum = escapeMbQuery(safeAlbum);
    const searchQueries = [];
    if (safeMbid) {
      searchQueries.push(`arid:${safeMbid} AND releasegroup:"${escapedAlbum}"`);
    }
    if (safeArtist) {
      searchQueries.push(
        `artist:"${escapeMbQuery(safeArtist)}" AND releasegroup:"${escapedAlbum}"`,
      );
    }
    for (const query of searchQueries) {
      try {
        const data = await musicbrainzRequest("/release-group", {
          query,
          limit: 5,
        });
        const releaseGroups = Array.isArray(data?.["release-groups"])
          ? data["release-groups"]
          : [];
        const best = pickBestCandidate(releaseGroups, safeAlbum, releaseYear);
        if (best?.id) {
          return {
            id: String(best.id),
            title: String(best.title || safeAlbum).trim() || safeAlbum,
            releaseYear: getYear(best["first-release-date"]),
          };
        }
      } catch {}
    }
    return null;
  })();
  releaseGroupSearchCache.set(cacheKey, promise);
  const resolved = await promise;
  releaseGroupSearchCache.set(cacheKey, resolved);
  return resolved;
}

function flattenReleaseTracks(releaseData) {
  const media = Array.isArray(releaseData?.media) ? releaseData.media : [];
  const tracks = [];
  for (const medium of media) {
    const mediumTracks = Array.isArray(medium?.tracks) ? medium.tracks : [];
    for (const track of mediumTracks) {
      const recording = track?.recording || null;
      const trackTitle =
        String(
          recording?.title ||
            track?.title ||
            track?.name ||
            "",
        ).trim();
      if (!trackTitle) continue;
      tracks.push({
        title: trackTitle,
        trackNumber:
          track?.position != null && Number.isFinite(Number(track.position))
            ? Number(track.position)
            : null,
        durationMs:
          track?.length != null && Number.isFinite(Number(track.length))
            ? Number(track.length)
            : recording?.length != null && Number.isFinite(Number(recording.length))
              ? Number(recording.length)
              : null,
        recordingId: recording?.id ? String(recording.id) : null,
      });
    }
  }
  return tracks;
}

function matchTrackByTitle(tracks, trackName) {
  const safeTrackName = String(trackName || "").trim();
  if (!safeTrackName) return null;
  return [...(Array.isArray(tracks) ? tracks : [])]
    .map((track) => ({
      ...track,
      _score: scoreTextMatch(track?.title, safeTrackName),
    }))
    .sort((left, right) => right._score - left._score)[0] || null;
}

async function fetchReleaseContext(albumMbid) {
  const key = String(albumMbid || "").trim();
  if (!key) return null;
  if (releaseContextCache.has(key)) {
    return releaseContextCache.get(key);
  }
  const promise = (async () => {
    try {
      const releaseGroupData = await musicbrainzRequest(`/release-group/${key}`, {
        inc: "releases",
      });
      const releases = Array.isArray(releaseGroupData?.releases)
        ? releaseGroupData.releases
        : [];
      const pickedRelease =
        releases.find((release) => String(release?.status || "").toLowerCase() === "official") ||
        releases[0] ||
        null;
      if (!pickedRelease?.id) {
        return {
          releaseYear: getYear(releaseGroupData?.["first-release-date"]),
          albumTrackCount: null,
          albumTrackTitles: [],
          tracks: [],
        };
      }
      const releaseData = await musicbrainzRequest(`/release/${pickedRelease.id}`, {
        inc: "recordings+artist-credits",
      });
      const tracks = flattenReleaseTracks(releaseData);
      return {
        releaseYear:
          getYear(pickedRelease?.date) ||
          getYear(releaseData?.date) ||
          getYear(releaseGroupData?.["first-release-date"]),
        albumTrackCount: tracks.length > 0 ? tracks.length : null,
        albumTrackTitles: tracks.map((track) => track.title),
        tracks,
      };
    } catch {
      return null;
    }
  })();
  releaseContextCache.set(key, promise);
  const resolved = await promise;
  releaseContextCache.set(key, resolved);
  return resolved;
}

async function fetchLastfmTrackInfo(track) {
  const artistName = String(track?.artistName || "").trim();
  const trackName = String(track?.trackName || "").trim();
  if (!artistName || !trackName) return null;
  try {
    return await lastfmRequest("track.getInfo", {
      artist: artistName,
      track: trackName,
      autocorrect: 1,
    });
  } catch {
    return null;
  }
}

export async function resolveWeeklyFlowTrackContext(track) {
  const base = {
    ...track,
    artistName: String(track?.artistName || "").trim(),
    trackName: String(track?.trackName || "").trim(),
    albumName: String(track?.albumName || "").trim() || null,
    artistMbid: String(track?.artistMbid || "").trim() || null,
    albumMbid: String(track?.albumMbid || "").trim() || null,
    trackMbid: String(track?.trackMbid || "").trim() || null,
    releaseYear: getYear(track?.releaseYear) || null,
    durationMs:
      track?.durationMs != null && Number.isFinite(Number(track.durationMs))
        ? Math.max(0, Math.round(Number(track.durationMs)))
        : null,
    artistAliases: Array.isArray(track?.artistAliases)
      ? track.artistAliases.map((entry) => String(entry || "").trim()).filter(Boolean)
      : [],
  };
  if (!base.artistName || !base.trackName) {
    return base;
  }

  const lastfmInfo =
    !base.albumName || !base.trackMbid || !base.durationMs
      ? await fetchLastfmTrackInfo(base)
      : null;
  const lastfmTrack = lastfmInfo?.track || null;
  const lastfmAlbumName = String(
    lastfmTrack?.album?.title || lastfmTrack?.album?.["#text"] || "",
  ).trim();
  const lastfmTrackMbid = String(lastfmTrack?.mbid || "").trim();
  const lastfmDuration =
    lastfmTrack?.duration != null && Number.isFinite(Number(lastfmTrack.duration))
      ? Math.max(0, Math.round(Number(lastfmTrack.duration)))
      : null;

  if (!base.albumName && lastfmAlbumName) {
    base.albumName = lastfmAlbumName;
  }
  if (!base.trackMbid && lastfmTrackMbid) {
    base.trackMbid = lastfmTrackMbid;
  }
  if (!base.durationMs && lastfmDuration) {
    base.durationMs = lastfmDuration;
  }

  if (!base.artistMbid) {
    base.artistMbid = await musicbrainzResolveArtistMbidByName(base.artistName);
  }

  if ((base.artistAliases?.length || 0) === 0 && base.artistMbid) {
    base.artistAliases = await fetchArtistAliases(base.artistMbid);
  }

  let releaseContext = null;
  if (!base.albumMbid && base.albumName) {
    const releaseGroup = await resolveReleaseGroup(
      base.artistName,
      base.artistMbid,
      base.albumName,
      base.releaseYear,
    );
    if (releaseGroup?.id) {
      base.albumMbid = releaseGroup.id;
      if (!base.releaseYear && releaseGroup.releaseYear) {
        base.releaseYear = releaseGroup.releaseYear;
      }
      if (!base.albumName && releaseGroup.title) {
        base.albumName = releaseGroup.title;
      }
    }
  }

  if (base.albumMbid) {
    releaseContext = await fetchReleaseContext(base.albumMbid);
    if (releaseContext?.releaseYear && !base.releaseYear) {
      base.releaseYear = releaseContext.releaseYear;
    }
    const matchedTrack = matchTrackByTitle(releaseContext?.tracks, base.trackName);
    if (matchedTrack) {
      if (!base.trackMbid && matchedTrack.recordingId) {
        base.trackMbid = matchedTrack.recordingId;
      }
      if (!base.durationMs && matchedTrack.durationMs) {
        base.durationMs = matchedTrack.durationMs;
      }
      base.trackNumber =
        matchedTrack.trackNumber != null &&
        Number.isFinite(Number(matchedTrack.trackNumber))
          ? Number(matchedTrack.trackNumber)
          : null;
    }
    base.albumTrackCount = releaseContext?.albumTrackCount ?? null;
    base.albumTrackTitles = Array.isArray(releaseContext?.albumTrackTitles)
      ? releaseContext.albumTrackTitles
      : [];
  } else {
    base.albumTrackCount = null;
    base.albumTrackTitles = [];
    base.trackNumber = null;
  }

  return base;
}
