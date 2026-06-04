import test from "node:test";
import assert from "node:assert/strict";

import {
  applyIsolatedBackendEnv,
  cleanupIsolatedState,
  createIsolatedStateDir,
  importFromRepo,
} from "./helpers/backendTestHarness.js";

const isolatedState = await createIsolatedStateDir("lidarr-client-cache");
applyIsolatedBackendEnv(isolatedState);

const { LidarrClient } = await importFromRepo("backend/services/lidarrClient.js");

test.after(async () => {
  await cleanupIsolatedState(isolatedState);
});

test("getArtistByMbid refreshes the Lidarr artist list after a cached miss", async () => {
  const client = new LidarrClient();
  const targetMbid = "8e9516ba-f417-47dd-a8a5-8998b94553f8";
  const targetArtist = {
    id: 1379,
    artistName: "Candlebox",
    foreignArtistId: targetMbid,
  };
  const calls = [];

  client._artistListCache = {
    at: Date.now(),
    data: [
      {
        id: 1,
        artistName: "Different Artist",
        foreignArtistId: "11111111-1111-4111-8111-111111111111",
      },
    ],
  };
  client.request = async (endpoint, method, data, skipConfigUpdate, options) => {
    calls.push({ endpoint, method, options });
    return [targetArtist];
  };

  const artist = await client.getArtistByMbid(targetMbid);

  assert.equal(artist, targetArtist);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].endpoint, "/artist");
  assert.equal(calls[0].method, "GET");
  assert.equal(calls[0].options?.bypassCache, true);
});

test("getArtistByMbid does not keep long-lived negative cache entries", async () => {
  const client = new LidarrClient();
  const missingMbid = "22222222-2222-4222-8222-222222222222";

  client.request = async () => [];

  const artist = await client.getArtistByMbid(missingMbid);

  assert.equal(artist, null);
  assert.equal(client._getArtistByMbidCacheEntry(missingMbid), undefined);
});
