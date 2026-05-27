import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

import {
  createIsolatedStateDir,
  applyIsolatedBackendEnv,
  cleanupIsolatedState,
  importFromRepo,
  resetDatabase,
  startServerProcess,
  buildApiUrl,
} from "../helpers/backendTestHarness.js";

const isolatedState = await createIsolatedStateDir("lidarr-preferences-api");
applyIsolatedBackendEnv(isolatedState);

const [{ db }, { userOps, dbOps }, bcryptModule] = await Promise.all([
  importFromRepo("backend/config/db-sqlite.js"),
  importFromRepo("backend/config/db-helpers.js"),
  import("bcrypt"),
]);

const bcrypt = bcryptModule.default;
const DEFAULT_ROOT_FOLDERS = [
  { path: "/music/main" },
  { path: "/music/alt" },
];
const DEFAULT_QUALITY_PROFILES = [
  { id: 7, name: "Lossless" },
  { id: 9, name: "Compressed" },
];
const DEFAULT_TAGS = [
  { id: 3, label: "Aurral" },
  { id: 4, label: "Wishlist" },
];

function json(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json" });
  res.end(JSON.stringify(payload));
}

async function readJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function startFakeLidarr() {
  const state = {
    rootFolders: DEFAULT_ROOT_FOLDERS.map((folder) => ({ ...folder })),
    qualityProfiles: DEFAULT_QUALITY_PROFILES.map((profile) => ({
      ...profile,
    })),
    tags: DEFAULT_TAGS.map((tag) => ({ ...tag })),
    metadataProfiles: [{ id: 1, name: "Standard" }],
    artists: [],
    postedArtists: [],
    nextArtistId: 100,
  };

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://127.0.0.1");
    if (req.headers["x-api-key"] !== "fake-key") {
      return json(res, 401, { message: "Invalid API key" });
    }

    if (req.method === "GET" && url.pathname === "/api/v1/rootFolder") {
      return json(res, 200, state.rootFolders);
    }
    if (req.method === "GET" && url.pathname === "/api/v1/qualityprofile") {
      return json(res, 200, state.qualityProfiles);
    }
    if (req.method === "GET" && url.pathname === "/api/v1/tag") {
      return json(res, 200, state.tags);
    }
    if (req.method === "GET" && url.pathname === "/api/v1/metadataprofile") {
      return json(res, 200, state.metadataProfiles);
    }
    if (req.method === "GET" && url.pathname === "/api/v1/artist") {
      return json(res, 200, state.artists);
    }
    if (
      req.method === "GET" &&
      url.pathname.startsWith("/api/v1/artist/") &&
      url.pathname !== "/api/v1/artist/"
    ) {
      const artistId = url.pathname.split("/").pop();
      const artist = state.artists.find((entry) => String(entry.id) === artistId);
      if (!artist) {
        return json(res, 404, { message: "Artist not found" });
      }
      return json(res, 200, artist);
    }
    if (req.method === "POST" && url.pathname === "/api/v1/artist") {
      const payload = await readJsonBody(req);
      state.postedArtists.push(payload);
      const qualityProfile =
        state.qualityProfiles.find((profile) => profile.id === payload.qualityProfileId) ||
        null;
      const artist = {
        id: state.nextArtistId++,
        artistName: payload.artistName,
        foreignArtistId: payload.foreignArtistId,
        path: `${payload.rootFolderPath}/${payload.artistName}`,
        added: new Date().toISOString(),
        monitored: payload.monitored,
        monitor: payload.monitor,
        monitorNewItems: payload.monitorNewItems,
        addOptions: payload.addOptions,
        qualityProfile,
        statistics: {
          albumCount: 0,
          trackCount: 0,
          sizeOnDisk: 0,
        },
      };
      state.artists.push(artist);
      return json(res, 201, artist);
    }

    return json(res, 404, { message: "Not found" });
  });

  await new Promise((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    state,
    url: `http://127.0.0.1:${port}`,
    reset() {
      state.rootFolders = DEFAULT_ROOT_FOLDERS.map((folder) => ({ ...folder }));
      state.qualityProfiles = DEFAULT_QUALITY_PROFILES.map((profile) => ({
        ...profile,
      }));
      state.tags = DEFAULT_TAGS.map((tag) => ({ ...tag }));
      state.metadataProfiles = [{ id: 1, name: "Standard" }];
      state.artists = [];
      state.postedArtists = [];
      state.nextArtistId = 100;
    },
    async stop() {
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

let server = null;
let fakeLidarr = null;
let authToken = "";
let adminUserId = null;

async function apiFetch(path, options = {}) {
  const headers = {
    Authorization: `Bearer ${authToken}`,
    ...(options.body ? { "Content-Type": "application/json" } : {}),
    ...(options.headers || {}),
  };
  const response = await fetch(buildApiUrl(server.port, path), {
    ...options,
    headers,
  });
  const text = await response.text();
  const payload = text ? JSON.parse(text) : null;
  return { response, payload };
}

async function loginAsAdmin() {
  const response = await fetch(buildApiUrl(server.port, "/api/auth/login"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "admin",
      password: "password123",
    }),
  });
  const payload = await response.json();
  assert.equal(response.status, 200);
  return payload.token;
}

async function saveLidarrSettings({ apiKey = "fake-key", rootFolderPath = "/music/main", qualityProfileId = 7 } = {}) {
  const { response, payload } = await apiFetch("/api/settings", {
    method: "POST",
    body: JSON.stringify({
      rootFolderPath,
      integrations: {
        lidarr: {
          url: fakeLidarr.url,
          apiKey,
          qualityProfileId,
        },
      },
    }),
  });
  assert.equal(response.status, 200, JSON.stringify(payload));
}

async function waitForPostedArtist(mbid) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const match = fakeLidarr.state.postedArtists.find(
      (artist) => artist.foreignArtistId === mbid,
    );
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for fake Lidarr add for ${mbid}`);
}

test.before(async () => {
  resetDatabase(db);
  fakeLidarr = await startFakeLidarr();
  dbOps.updateSettings({
    integrations: {
      lidarr: {
        url: fakeLidarr.url,
        apiKey: "fake-key",
        qualityProfileId: 7,
      },
    },
    rootFolderPath: "/music/main",
    onboardingComplete: true,
  });
  const admin = userOps.createUser(
    "admin",
    bcrypt.hashSync("password123", 4),
    "admin",
  );
  adminUserId = admin?.id || null;
  server = await startServerProcess();
  authToken = await loginAsAdmin();
});

test.beforeEach(async () => {
  fakeLidarr.reset();
  userOps.updateUser(adminUserId, {
    lidarrRootFolderPath: null,
    lidarrQualityProfileId: null,
  });
  await saveLidarrSettings();
});

test.after(async () => {
  await server?.stop();
  await fakeLidarr?.stop();
  await cleanupIsolatedState(isolatedState);
});

test("GET /users/me/lidarr-preferences returns configured false with empty options when Lidarr is unavailable", async () => {
  await saveLidarrSettings({ apiKey: "", rootFolderPath: "/music/main" });

  const { response, payload } = await apiFetch("/api/users/me/lidarr-preferences");

  assert.equal(response.status, 200);
  assert.equal(payload.configured, false);
  assert.deepEqual(payload.rootFolders, []);
  assert.deepEqual(payload.qualityProfiles, []);
  assert.deepEqual(payload.fallbacks, {
    rootFolderPath: null,
    qualityProfileId: null,
    tagId: null,
  });
});

test("GET /users/me/lidarr-preferences returns live options plus saved defaults and global fallbacks", async () => {
  userOps.updateUser(adminUserId, {
    lidarrRootFolderPath: "/music/alt",
    lidarrQualityProfileId: 9,
  });

  const { response, payload } = await apiFetch("/api/users/me/lidarr-preferences");

  assert.equal(response.status, 200);
  assert.equal(payload.configured, true);
  assert.deepEqual(payload.rootFolders, DEFAULT_ROOT_FOLDERS);
  assert.deepEqual(payload.qualityProfiles, DEFAULT_QUALITY_PROFILES);
  assert.deepEqual(payload.tags, DEFAULT_TAGS);
  assert.deepEqual(payload.savedDefaults, {
    rootFolderPath: "/music/alt",
    qualityProfileId: 9,
    tagId: null,
  });
  assert.deepEqual(payload.fallbacks, {
    rootFolderPath: "/music/main",
    qualityProfileId: 7,
    tagId: null,
  });
});

test("PATCH /users/me/lidarr-preferences accepts valid selections and clears them with null", async () => {
  const saveResult = await apiFetch("/api/users/me/lidarr-preferences", {
    method: "PATCH",
    body: JSON.stringify({
      rootFolderPath: "/music/alt",
      qualityProfileId: 9,
    }),
  });

  assert.equal(saveResult.response.status, 200);
  assert.deepEqual(saveResult.payload.savedDefaults, {
    rootFolderPath: "/music/alt",
    qualityProfileId: 9,
    tagId: null,
  });

  const stored = userOps.getUserById(adminUserId);
  assert.equal(stored?.lidarrRootFolderPath, "/music/alt");
  assert.equal(stored?.lidarrQualityProfileId, 9);

  const clearResult = await apiFetch("/api/users/me/lidarr-preferences", {
    method: "PATCH",
    body: JSON.stringify({
      rootFolderPath: null,
      qualityProfileId: null,
    }),
  });

  assert.equal(clearResult.response.status, 200);
  assert.deepEqual(clearResult.payload.savedDefaults, {
    rootFolderPath: null,
    qualityProfileId: null,
    tagId: null,
  });
});

test("PATCH /users/me/lidarr-preferences rejects invalid root folders and quality profiles", async () => {
  const invalidRoot = await apiFetch("/api/users/me/lidarr-preferences", {
    method: "PATCH",
    body: JSON.stringify({
      rootFolderPath: "/music/missing",
    }),
  });

  assert.equal(invalidRoot.response.status, 400);
  assert.equal(invalidRoot.payload.field, "rootFolderPath");

  const invalidQuality = await apiFetch("/api/users/me/lidarr-preferences", {
    method: "PATCH",
    body: JSON.stringify({
      qualityProfileId: 999,
    }),
  });

  assert.equal(invalidQuality.response.status, 400);
  assert.equal(invalidQuality.payload.field, "qualityProfileId");
});

test("POST /library/artists uses explicit request overrides over saved defaults", async () => {
  userOps.updateUser(adminUserId, {
    lidarrRootFolderPath: "/music/main",
    lidarrQualityProfileId: 7,
  });

  const mbid = "11111111-1111-1111-1111-111111111111";
  const { response, payload } = await apiFetch("/api/library/artists", {
    method: "POST",
    body: JSON.stringify({
      foreignArtistId: mbid,
      artistName: "Override Artist",
      rootFolderPath: "/music/alt",
      qualityProfileId: 9,
    }),
  });

  assert.equal(response.status, 202, JSON.stringify(payload));

  const posted = await waitForPostedArtist(mbid);
  assert.equal(posted.rootFolderPath, "/music/alt");
  assert.equal(posted.qualityProfileId, 9);
});

test("POST /library/artists uses saved per-user defaults when no overrides are provided", async () => {
  userOps.updateUser(adminUserId, {
    lidarrRootFolderPath: "/music/alt",
    lidarrQualityProfileId: 9,
  });

  const mbid = "22222222-2222-2222-2222-222222222222";
  const { response, payload } = await apiFetch("/api/library/artists", {
    method: "POST",
    body: JSON.stringify({
      foreignArtistId: mbid,
      artistName: "Saved Default Artist",
    }),
  });

  assert.equal(response.status, 202, JSON.stringify(payload));

  const posted = await waitForPostedArtist(mbid);
  assert.equal(posted.rootFolderPath, "/music/alt");
  assert.equal(posted.qualityProfileId, 9);
});

test("POST /library/artists falls back to global defaults when the user has no saved defaults", async () => {
  const mbid = "33333333-3333-3333-3333-333333333333";
  const { response, payload } = await apiFetch("/api/library/artists", {
    method: "POST",
    body: JSON.stringify({
      foreignArtistId: mbid,
      artistName: "Fallback Artist",
    }),
  });

  assert.equal(response.status, 202, JSON.stringify(payload));

  const posted = await waitForPostedArtist(mbid);
  assert.equal(posted.rootFolderPath, "/music/main");
  assert.equal(posted.qualityProfileId, 7);
});

test("POST /library/artists returns 409 when saved defaults are stale", async () => {
  userOps.updateUser(adminUserId, {
    lidarrRootFolderPath: "/music/stale",
    lidarrQualityProfileId: 999,
  });

  const { response, payload } = await apiFetch("/api/library/artists", {
    method: "POST",
    body: JSON.stringify({
      foreignArtistId: "44444444-4444-4444-4444-444444444444",
      artistName: "Stale Artist",
    }),
  });

  assert.equal(response.status, 409);
  assert.equal(payload.field, "rootFolderPath");
  assert.match(payload.message, /saved Lidarr root folder/i);
  assert.equal(fakeLidarr.state.postedArtists.length, 0);
});
