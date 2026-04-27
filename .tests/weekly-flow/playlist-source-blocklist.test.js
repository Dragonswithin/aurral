import test from "node:test";
import assert from "node:assert/strict";

import {
  createIsolatedStateDir,
  applyIsolatedBackendEnv,
  cleanupIsolatedState,
  importFromRepo,
  resetDatabase,
} from "../helpers/backendTestHarness.js";

const isolatedState = await createIsolatedStateDir("playlist-source-blocklist");
applyIsolatedBackendEnv(isolatedState);

const [{ db }, { dbOps }, playlistSourceModule] = await Promise.all([
  importFromRepo("backend/config/db-sqlite.js"),
  importFromRepo("backend/config/db-helpers.js"),
  importFromRepo("backend/services/weeklyFlowPlaylistSource.js"),
]);

const { WeeklyFlowPlaylistSource } = playlistSourceModule;

test.beforeEach(() => {
  resetDatabase(db);
  dbOps.updateSettings({
    integrations: {},
    onboardingComplete: true,
    blocklist: { artists: [], tags: [] },
  });
});

test.after(async () => {
  await cleanupIsolatedState(isolatedState);
});

test("getTracksForFlow filters blocked artists from source tracks without failing", async () => {
  dbOps.updateSettings({
    ...dbOps.getSettings(),
    blocklist: {
      artists: [{ mbid: "11111111-1111-1111-1111-111111111111", name: "Blocked Artist" }],
      tags: [],
    },
  });

  const source = new WeeklyFlowPlaylistSource();
  source.getDiscoverTracks = async (_limit, options = {}) =>
    source._filterTracksByBlocklist(
      [
        {
          artistName: "Blocked Artist",
          artistMbid: "11111111-1111-1111-1111-111111111111",
          trackName: "Should Not Appear",
        },
        {
          artistName: "Allowed Artist",
          artistMbid: "22222222-2222-2222-2222-222222222222",
          trackName: "Should Appear",
        },
      ],
      options.blocklist,
    );
  source.getMixTracks = async () => [];
  source.getTrendingTracks = async () => [];
  source.getTagTracks = async () => [];
  source.getRelatedArtistTracks = async () => [];

  const tracks = await source.getTracksForFlow({
    size: 2,
    mix: { discover: 100, mix: 0, trending: 0 },
  });

  assert.equal(tracks.length, 1);
  assert.equal(tracks[0].artistName, "Allowed Artist");
});

test("getTagTracks returns no tracks when the requested tag is blocklisted", async () => {
  dbOps.updateSettings({
    ...dbOps.getSettings(),
    integrations: {
      lastfm: {
        apiKey: "test-key",
      },
    },
    blocklist: {
      artists: [],
      tags: ["metal"],
    },
  });

  const source = new WeeklyFlowPlaylistSource();
  const tracks = await source.getTagTracks("metal", 5, {
    blocklist: source._getBlocklist(),
  });

  assert.deepEqual(tracks, []);
});
