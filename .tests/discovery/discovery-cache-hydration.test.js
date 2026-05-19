import test from "node:test";
import assert from "node:assert/strict";
import path from "path";
import { pathToFileURL } from "url";

import {
  createIsolatedStateDir,
  applyIsolatedBackendEnv,
  cleanupIsolatedState,
  importFromRepo,
  resetDatabase,
} from "../helpers/backendTestHarness.js";

const isolatedState = await createIsolatedStateDir("discovery-cache-hydration");
applyIsolatedBackendEnv(isolatedState);

const [{ db }, { dbOps }] = await Promise.all([
  importFromRepo("backend/config/db-sqlite.js"),
  importFromRepo("backend/config/db-helpers.js"),
]);

test.after(async () => {
  await cleanupIsolatedState(isolatedState);
});

test("getDiscoveryCache preserves lastUpdated after an empty completed refresh", async () => {
  resetDatabase(db);

  dbOps.updateDiscoveryCache({
    recommendations: [],
    globalTop: [],
    basedOn: [],
    topTags: [],
    topGenres: [],
  });

  const moduleUrl = pathToFileURL(
    path.join(process.cwd(), "backend/services/discoveryService.js"),
  ).href;
  const { getDiscoveryCache } = await import(`${moduleUrl}?t=${Date.now()}`);
  const cache = getDiscoveryCache();

  assert.ok(cache.lastUpdated);
  assert.deepEqual(cache.recommendations, []);
  assert.deepEqual(cache.globalTop, []);
  assert.deepEqual(cache.topGenres, []);
  assert.equal(cache.isUpdating, false);
});
