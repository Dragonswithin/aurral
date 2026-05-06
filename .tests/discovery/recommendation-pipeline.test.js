import test from "node:test";
import assert from "node:assert/strict";

import {
  addRecommendationCandidate,
  buildDiscoverySeedList,
  finalizeRecommendationAccumulator,
  mergeResolvedRecommendations,
} from "../../backend/services/discoveryRecommendations.js";

test("buildDiscoverySeedList prefers listening-history weight when the same artist exists in library and history", () => {
  const seeds = buildDiscoverySeedList({
    libraryArtists: [
      {
        mbid: "11111111-1111-1111-1111-111111111111",
        artistName: "Library Artist",
        source: "library",
      },
    ],
    historyArtists: [
      {
        mbid: "11111111-1111-1111-1111-111111111111",
        artistName: "Library Artist",
        source: "listenbrainz",
        playcount: 42,
      },
      {
        mbid: "22222222-2222-2222-2222-222222222222",
        artistName: "History Only",
        source: "lastfm",
        playcount: 12,
      },
    ],
  });

  assert.equal(seeds.length, 2);
  assert.equal(seeds[0].mbid, "11111111-1111-1111-1111-111111111111");
  assert.equal(seeds[0].source, "listenbrainz");
  assert.ok(seeds[0].weight > 1.3);
  assert.equal(seeds[1].source, "lastfm");
});

test("recommendation candidates aggregate across multiple seeds", () => {
  const accumulator = new Map();
  const existingArtistKeys = new Set();
  const profileTagSet = new Set(["dream-pop", "shoegaze"]);

  addRecommendationCandidate(accumulator, {
    candidate: {
      mbid: "33333333-3333-3333-3333-333333333333",
      name: "Candidate Artist",
      match: 0.81,
    },
    seed: {
      artistName: "Seed One",
      source: "library",
      weight: 1.2,
    },
    sourceTags: ["Dream-Pop", "Indie"],
    profileTagSet,
    existingArtistKeys,
  });

  addRecommendationCandidate(accumulator, {
    candidate: {
      mbid: "33333333-3333-3333-3333-333333333333",
      name: "Candidate Artist",
      match: 0.73,
    },
    seed: {
      artistName: "Seed Two",
      source: "listenbrainz",
      weight: 1.5,
    },
    sourceTags: ["Shoegaze"],
    profileTagSet,
    existingArtistKeys,
  });

  const [recommendation] = finalizeRecommendationAccumulator(accumulator, 10);
  assert.equal(recommendation.name, "Candidate Artist");
  assert.equal(recommendation.seedCount, 2);
  assert.equal(recommendation.sourceType, "blended");
  assert.deepEqual(
    recommendation.sourceArtists.sort(),
    ["Seed One", "Seed Two"],
  );
  assert.ok(recommendation.score > 200);
  assert.ok(recommendation.tags.includes("dream-pop"));
  assert.ok(recommendation.tags.includes("shoegaze"));
});

test("mergeResolvedRecommendations collapses name and mbid variants of the same artist", () => {
  const merged = mergeResolvedRecommendations([
    {
      name: "Slowdive",
      score: 140,
      sourceArtist: "Seed One",
      sourceType: "library",
      tags: ["shoegaze"],
    },
    {
      id: "44444444-4444-4444-4444-444444444444",
      navigateTo: "44444444-4444-4444-4444-444444444444",
      name: "Slowdive",
      score: 155,
      sourceArtists: ["Seed Two"],
      sourceTypes: ["lastfm"],
      tags: ["dream-pop"],
    },
  ]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0].id, "44444444-4444-4444-4444-444444444444");
  assert.equal(merged[0].sourceType, "blended");
  assert.deepEqual(
    merged[0].tags.sort(),
    ["dream-pop", "shoegaze"],
  );
});
