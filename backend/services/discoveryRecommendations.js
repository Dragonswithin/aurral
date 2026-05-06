const MBID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const SOURCE_BASE_WEIGHTS = {
  library: 1,
  lastfm: 1.2,
  listenbrainz: 1.3,
};

const normalizeText = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const normalizeMbid = (value) => {
  const normalized = normalizeText(value);
  return MBID_REGEX.test(normalized) ? normalized : null;
};

export const normalizeArtistIdentityKeys = (artist) => {
  const keys = [];
  const mbids = [artist?.id, artist?.mbid, artist?.foreignArtistId]
    .map(normalizeMbid)
    .filter(Boolean);
  for (const mbid of mbids) {
    keys.push(`mbid:${mbid}`);
  }
  const names = [artist?.name, artist?.artistName]
    .map(normalizeText)
    .filter(Boolean);
  for (const name of names) {
    keys.push(`name:${name}`);
  }
  return [...new Set(keys)];
};

export const buildExistingArtistKeySet = (artists = []) => {
  const keys = new Set();
  for (const artist of Array.isArray(artists) ? artists : []) {
    for (const key of normalizeArtistIdentityKeys(artist)) {
      keys.add(key);
    }
  }
  return keys;
};

const calculateSeedWeight = (seed, index) => {
  const source = normalizeText(seed?.source) || "library";
  const baseWeight = SOURCE_BASE_WEIGHTS[source] || 1;

  if (source === "library") {
    const recencyBoost = Math.max(0, 0.5 - Math.max(index, 0) * 0.02);
    return Number((baseWeight + recencyBoost).toFixed(4));
  }

  const playcount = Math.max(0, Number(seed?.playcount || 0));
  const playcountBoost =
    playcount > 0 ? Math.min(1.4, Math.log10(playcount + 1) * 0.4) : 0.15;
  return Number((baseWeight + playcountBoost).toFixed(4));
};

export const buildDiscoverySeedList = ({
  libraryArtists = [],
  historyArtists = [],
} = {}) => {
  const combined = [
    ...(Array.isArray(historyArtists) ? historyArtists : []),
    ...(Array.isArray(libraryArtists) ? libraryArtists : []),
  ];
  const seen = new Set();
  const seeds = [];

  for (let index = 0; index < combined.length; index += 1) {
    const artist = combined[index];
    const mbid = normalizeMbid(artist?.mbid || artist?.id || artist?.foreignArtistId);
    const artistName = String(artist?.artistName || artist?.name || "").trim();
    if (!mbid || !artistName) continue;

    const key = `mbid:${mbid}`;
    const source = normalizeText(artist?.source) || "library";
    const nextWeight = calculateSeedWeight(
      {
        source,
        playcount: artist?.playcount,
      },
      source === "library" ? index : 0,
    );

    if (seen.has(key)) {
      const existing = seeds.find((entry) => entry.mbid === mbid);
      if (existing) {
        existing.weight = Math.max(existing.weight, nextWeight);
        existing.playcount = Math.max(
          Number(existing.playcount || 0),
          Number(artist?.playcount || 0),
        );
        if (existing.source === "library" && source !== "library") {
          existing.source = source;
        }
      }
      continue;
    }

    seen.add(key);
    seeds.push({
      mbid,
      artistName,
      source,
      playcount: Math.max(0, Number(artist?.playcount || 0)),
      weight: nextWeight,
    });
  }

  return seeds.sort((left, right) => {
    if (right.weight !== left.weight) {
      return right.weight - left.weight;
    }
    if (right.playcount !== left.playcount) {
      return right.playcount - left.playcount;
    }
    return left.artistName.localeCompare(right.artistName);
  });
};

const summarizeSourceArtists = (sourceArtists) => {
  const artists = [...sourceArtists].filter(Boolean);
  if (artists.length === 0) return null;
  if (artists.length === 1) return artists[0];
  if (artists.length === 2) return `${artists[0]}, ${artists[1]}`;
  return `${artists[0]}, ${artists[1]} +${artists.length - 2} more`;
};

const mergeTags = (target, sourceTags = []) => {
  for (const tag of sourceTags) {
    const normalized = normalizeText(tag);
    if (!normalized) continue;
    if (target.size >= 12 && target.has(normalized) === false) continue;
    target.add(normalized);
  }
};

export const addRecommendationCandidate = (
  accumulator,
  {
    candidate,
    seed,
    sourceTags = [],
    profileTagSet = new Set(),
    existingArtistKeys = new Set(),
  } = {},
) => {
  if (!accumulator || !candidate || !seed) return;

  const name = String(candidate?.name || "").trim();
  const mbid = normalizeMbid(candidate?.mbid);
  if (!name && !mbid) return;

  const candidateKeys = normalizeArtistIdentityKeys({
    id: mbid,
    name,
  });
  if (candidateKeys.some((key) => existingArtistKeys.has(key))) {
    return;
  }

  const candidateKey = mbid || `name:${normalizeText(name)}`;
  if (!candidateKey) return;

  const seedWeight = Number(seed?.weight || 1);
  const matchScore = Math.max(0, Number(candidate?.match || 0));
  const overlapCount = sourceTags.reduce((count, tag) => {
    const normalized = normalizeText(tag);
    return normalized && profileTagSet.has(normalized) ? count + 1 : count;
  }, 0);
  const tagBoost = 1 + Math.min(0.4, overlapCount * 0.08);
  const scoreIncrement = Math.max(8, matchScore * 100) * seedWeight * tagBoost;

  const existing = accumulator.get(candidateKey);
  if (existing) {
    existing.score += scoreIncrement;
    existing.seedCount += 1;
    existing.bestMatch = Math.max(existing.bestMatch, matchScore);
    existing.tagOverlapScore += overlapCount;
    existing.sourceArtists.add(seed.artistName);
    existing.sourceTypes.add(seed.source || "library");
    if (!existing.image && candidate?.image) {
      existing.image = candidate.image;
    }
    mergeTags(existing.tags, sourceTags);
    if (mbid && !existing.id) {
      existing.id = mbid;
    }
    return;
  }

  const tags = new Set();
  mergeTags(tags, sourceTags);
  accumulator.set(candidateKey, {
    id: mbid,
    name,
    type: "Artist",
    image: candidate?.image || null,
    score: scoreIncrement,
    bestMatch: matchScore,
    seedCount: 1,
    tagOverlapScore: overlapCount,
    sourceArtists: new Set([seed.artistName]),
    sourceTypes: new Set([seed.source || "library"]),
    tags,
  });
};

export const finalizeRecommendationAccumulator = (
  accumulator,
  limit = 100,
) => {
  return [...accumulator.values()]
    .map((entry) => ({
      id: entry.id || null,
      name: entry.name,
      type: "Artist",
      image: entry.image || null,
      tags: [...entry.tags],
      seedCount: entry.seedCount,
      score: Math.round(
        entry.score +
          Math.max(0, entry.seedCount - 1) * 12 +
          Math.min(30, entry.tagOverlapScore * 2),
      ),
      sourceArtist: summarizeSourceArtists(entry.sourceArtists),
      sourceArtists: [...entry.sourceArtists],
      sourceType:
        entry.sourceTypes.size === 1
          ? [...entry.sourceTypes][0]
          : "blended",
      sourceTypes: [...entry.sourceTypes],
      bestMatch: entry.bestMatch,
    }))
    .filter((entry) => entry.name)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (right.seedCount !== left.seedCount) {
        return right.seedCount - left.seedCount;
      }
      if (right.bestMatch !== left.bestMatch) {
        return right.bestMatch - left.bestMatch;
      }
      return left.name.localeCompare(right.name);
    })
    .slice(0, Math.max(1, Number(limit) || 100));
};

export const mergeResolvedRecommendations = (
  recommendations = [],
  existingArtistKeys = new Set(),
) => {
  const merged = new Map();
  const aliases = new Map();

  for (const recommendation of Array.isArray(recommendations)
    ? recommendations
    : []) {
    const keys = normalizeArtistIdentityKeys(recommendation);
    if (keys.some((key) => existingArtistKeys.has(key))) {
      continue;
    }

    const identityKeys = [
      normalizeMbid(recommendation?.id),
      `name:${normalizeText(recommendation?.name)}`,
    ].filter(Boolean);
    if (identityKeys.length === 0) continue;
    const existingIdentity = identityKeys.find((key) => aliases.has(key));
    const identity = existingIdentity || identityKeys[0];

    const existing = merged.get(identity);
    if (!existing) {
      const entry = {
        ...recommendation,
        tags: Array.isArray(recommendation?.tags)
          ? [...recommendation.tags]
          : [],
        sourceArtists: Array.isArray(recommendation?.sourceArtists)
          ? [...recommendation.sourceArtists]
          : [],
        sourceTypes: Array.isArray(recommendation?.sourceTypes)
          ? [...recommendation.sourceTypes]
          : recommendation?.sourceType
            ? [recommendation.sourceType]
            : [],
      };
      merged.set(identity, entry);
      for (const key of identityKeys) {
        aliases.set(key, identity);
      }
      continue;
    }

    existing.id = existing.id || recommendation.id || null;
    existing.navigateTo =
      existing.navigateTo || recommendation.navigateTo || recommendation.id || null;
    existing.image = existing.image || recommendation.image || null;
    existing.score = Math.max(
      Number(existing.score || 0),
      Number(recommendation.score || 0),
    );
    existing.seedCount = Math.max(
      Number(existing.seedCount || 0),
      Number(recommendation.seedCount || 0),
    );
    existing.sourceArtists = [
      ...new Set([
        ...existing.sourceArtists,
        ...(Array.isArray(recommendation?.sourceArtists)
          ? recommendation.sourceArtists
          : recommendation?.sourceArtist
            ? [recommendation.sourceArtist]
            : []),
      ]),
    ];
    existing.sourceTypes = [
      ...new Set([
        ...existing.sourceTypes,
        ...(Array.isArray(recommendation?.sourceTypes)
          ? recommendation.sourceTypes
          : recommendation?.sourceType
            ? [recommendation.sourceType]
            : []),
      ]),
    ];
    existing.tags = [
      ...new Set([
        ...existing.tags,
        ...(Array.isArray(recommendation?.tags) ? recommendation.tags : []),
      ]),
    ];
    for (const key of identityKeys) {
      aliases.set(key, identity);
    }
  }

  return [...merged.values()].map((entry) => ({
    ...entry,
    sourceArtist: summarizeSourceArtists(entry.sourceArtists || []),
    sourceType:
      Array.isArray(entry.sourceTypes) && entry.sourceTypes.length === 1
        ? entry.sourceTypes[0]
        : "blended",
  }));
};
