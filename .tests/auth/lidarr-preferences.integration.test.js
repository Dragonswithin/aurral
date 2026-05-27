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
    albums: [],
    postedArtists: [],
    updatedArtists: [],
    updatedAlbums: [],
    commands: [],
    forceUnmonitoredArtistOnPost: false,
    unmonitorAfterAlbumSearch: false,
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
    if (
      req.method === "PUT" &&
      url.pathname.startsWith("/api/v1/artist/") &&
      url.pathname !== "/api/v1/artist/"
    ) {
      const artistId = url.pathname.split("/").pop();
      const payload = await readJsonBody(req);
      state.updatedArtists.push(payload);
      const artistIndex = state.artists.findIndex(
        (entry) => String(entry.id) === artistId,
      );
      if (artistIndex === -1) {
        return json(res, 404, { message: "Artist not found" });
      }
      state.artists[artistIndex] = {
        ...state.artists[artistIndex],
        ...payload,
        id: state.artists[artistIndex].id,
      };
      return json(res, 200, state.artists[artistIndex]);
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
        monitored: state.forceUnmonitoredArtistOnPost
          ? false
          : payload.monitored,
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
    if (req.method === "GET" && url.pathname === "/api/v1/album") {
      const artistId = url.searchParams.get("artistId");
      const albums = artistId
        ? state.albums.filter((album) => String(album.artistId) === artistId)
        : state.albums;
      return json(res, 200, albums);
    }
    if (
      req.method === "GET" &&
      url.pathname.startsWith("/api/v1/album/") &&
      url.pathname !== "/api/v1/album/"
    ) {
      const albumId = url.pathname.split("/").pop();
      const album = state.albums.find((entry) => String(entry.id) === albumId);
      if (!album) {
        return json(res, 404, { message: "Album not found" });
      }
      return json(res, 200, album);
    }
    if (
      req.method === "PUT" &&
      url.pathname.startsWith("/api/v1/album/") &&
      url.pathname !== "/api/v1/album/"
    ) {
      const albumId = url.pathname.split("/").pop();
      const payload = await readJsonBody(req);
      state.updatedAlbums.push(payload);
      const albumIndex = state.albums.findIndex(
        (entry) => String(entry.id) === albumId,
      );
      if (albumIndex === -1) {
        return json(res, 404, { message: "Album not found" });
      }
      state.albums[albumIndex] = {
        ...state.albums[albumIndex],
        ...payload,
        id: state.albums[albumIndex].id,
      };
      return json(res, 200, state.albums[albumIndex]);
    }
    if (req.method === "POST" && url.pathname === "/api/v1/command") {
      const payload = await readJsonBody(req);
      state.commands.push(payload);
      if (payload.name === "AlbumSearch" && state.unmonitorAfterAlbumSearch) {
        for (const albumId of payload.albumIds || []) {
          const album = state.albums.find(
            (entry) => String(entry.id) === String(albumId),
          );
          if (album) {
            album.monitored = false;
            const artist = state.artists.find(
              (entry) => String(entry.id) === String(album.artistId),
            );
            if (artist) {
              artist.monitored = false;
            }
          }
        }
      }
      return json(res, 201, { id: state.commands.length, ...payload });
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
      state.albums = [];
      state.postedArtists = [];
      state.updatedArtists = [];
      state.updatedAlbums = [];
      state.commands = [];
      state.forceUnmonitoredArtistOnPost = false;
      state.unmonitorAfterAlbumSearch = false;
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

async function saveLidarrSettings({
  apiKey = "fake-key",
  rootFolderPath = "/music/main",
  qualityProfileId = 7,
  defaultMonitorOption = "none",
  searchOnAdd = false,
} = {}) {
  const { response, payload } = await apiFetch("/api/settings", {
    method: "POST",
    body: JSON.stringify({
      rootFolderPath,
      integrations: {
        lidarr: {
          url: fakeLidarr.url,
          apiKey,
          qualityProfileId,
          defaultMonitorOption,
          searchOnAdd,
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

test("POST /library/artists preserves artist-only none monitoring defaults", async () => {
  await saveLidarrSettings({ defaultMonitorOption: "none" });

  const mbid = "55555555-5555-5555-5555-555555555555";
  const { response, payload } = await apiFetch("/api/library/artists", {
    method: "POST",
    body: JSON.stringify({
      foreignArtistId: mbid,
      artistName: "None Monitor Artist",
    }),
  });

  assert.equal(response.status, 202, JSON.stringify(payload));

  const posted = await waitForPostedArtist(mbid);
  assert.equal(posted.monitored, true);
  assert.equal(posted.monitor, "none");
  assert.equal(posted.monitorNewItems, "none");
  assert.equal(posted.addOptions.monitor, "none");
});

test("POST /library/artists repairs Lidarr artist checkbox when none add returns unmonitored", async () => {
  fakeLidarr.state.forceUnmonitoredArtistOnPost = true;

  const mbid = "56565656-5656-5656-5656-565656565656";
  const { response, payload } = await apiFetch("/api/library/artists", {
    method: "POST",
    body: JSON.stringify({
      foreignArtistId: mbid,
      artistName: "Repaired None Monitor Artist",
    }),
  });

  assert.equal(response.status, 202, JSON.stringify(payload));

  const posted = await waitForPostedArtist(mbid);
  assert.equal(posted.monitored, true);
  assert.equal(fakeLidarr.state.updatedArtists.length, 1);
  assert.equal(fakeLidarr.state.updatedArtists[0].monitored, true);
  assert.equal(fakeLidarr.state.updatedArtists[0].monitor, "none");
  assert.equal(fakeLidarr.state.updatedArtists[0].monitorNewItems, "none");
  assert.equal(fakeLidarr.state.updatedArtists[0].addOptions.monitor, "none");
});

test("POST /library/artists supports existing albums monitor option", async () => {
  const mbid = "66666666-6666-6666-6666-666666666666";
  const { response, payload } = await apiFetch("/api/library/artists", {
    method: "POST",
    body: JSON.stringify({
      foreignArtistId: mbid,
      artistName: "Existing Monitor Artist",
      monitorOption: "existing",
    }),
  });

  assert.equal(response.status, 202, JSON.stringify(payload));

  const posted = await waitForPostedArtist(mbid);
  assert.equal(posted.monitored, true);
  assert.equal(posted.monitor, "existing");
  assert.equal(posted.monitorNewItems, "none");
  assert.equal(posted.addOptions.monitor, "existing");
});

test("POST /library/artists uses existing albums monitor from global defaults", async () => {
  await saveLidarrSettings({ defaultMonitorOption: "existing" });

  const mbid = "77777777-7777-7777-7777-777777777777";
  const { response, payload } = await apiFetch("/api/library/artists", {
    method: "POST",
    body: JSON.stringify({
      foreignArtistId: mbid,
      artistName: "Default Existing Monitor Artist",
    }),
  });

  assert.equal(response.status, 202, JSON.stringify(payload));

  const posted = await waitForPostedArtist(mbid);
  assert.equal(posted.monitored, true);
  assert.equal(posted.monitor, "existing");
  assert.equal(posted.monitorNewItems, "none");
  assert.equal(posted.addOptions.monitor, "existing");
});

test("POST /library/artists only future-facing modes monitor new albums", async () => {
  const cases = [
    ["none", "none", "none"],
    ["missing", "missing", "none"],
    ["latest", "latest", "none"],
    ["first", "first", "none"],
    ["existing", "existing", "none"],
    ["future", "future", "all"],
    ["all", "all", "all"],
  ];

  for (const [
    index,
    [monitorOption, expectedMonitor, expectedMonitorNewItems],
  ] of cases.entries()) {
    const mbid = `88888888-8888-8888-8888-${String(index + 1).padStart(
      12,
      "0",
    )}`;
    const { response, payload } = await apiFetch("/api/library/artists", {
      method: "POST",
      body: JSON.stringify({
        foreignArtistId: mbid,
        artistName: `${monitorOption} Monitor Artist`,
        monitorOption,
      }),
    });

    assert.equal(response.status, 202, JSON.stringify(payload));

    const posted = await waitForPostedArtist(mbid);
    assert.equal(posted.monitored, true);
    assert.equal(posted.monitor, expectedMonitor);
    assert.equal(posted.monitorNewItems, expectedMonitorNewItems);
    assert.equal(posted.addOptions.monitor, expectedMonitor);
  }
});

test("PUT /library/artists/:mbid updates artist monitoring to existing albums", async () => {
  const mbid = "99999999-9999-9999-9999-999999999999";
  const addResult = await apiFetch("/api/library/artists", {
    method: "POST",
    body: JSON.stringify({
      foreignArtistId: mbid,
      artistName: "Updated Existing Monitor Artist",
    }),
  });
  assert.equal(addResult.response.status, 202, JSON.stringify(addResult.payload));

  await waitForPostedArtist(mbid);
  const artist = fakeLidarr.state.artists.find(
    (entry) => entry.foreignArtistId === mbid,
  );
  assert.ok(artist);
  fakeLidarr.state.albums.push({
    id: 900,
    artistId: artist.id,
    title: "Already Monitored",
    foreignAlbumId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    monitored: true,
    statistics: {
      trackCount: 1,
      sizeOnDisk: 0,
      percentOfTracks: 0,
    },
  });

  const { response, payload } = await apiFetch(`/api/library/artists/${mbid}`, {
    method: "PUT",
    body: JSON.stringify({
      monitored: true,
      monitorOption: "existing",
    }),
  });

  assert.equal(response.status, 200, JSON.stringify(payload));
  const updated = fakeLidarr.state.updatedArtists.at(-1);
  assert.equal(updated.monitored, true);
  assert.equal(updated.monitor, "existing");
  assert.equal(updated.monitorNewItems, "none");
  assert.equal(updated.addOptions.monitor, "existing");
  assert.equal(payload.monitorOption, "existing");
});

test("POST /library/downloads/album checks artist and monitors only the requested album", async () => {
  const artist = {
    id: 700,
    artistName: "Pick And Choose Artist",
    foreignArtistId: "abababab-abab-abab-abab-abababababab",
    path: "/music/main/Pick And Choose Artist",
    added: new Date().toISOString(),
    monitored: false,
    monitor: "none",
    monitorNewItems: "none",
    addOptions: {
      monitor: "none",
    },
    qualityProfile: DEFAULT_QUALITY_PROFILES[0],
    statistics: {
      albumCount: 1,
      trackCount: 0,
      sizeOnDisk: 0,
    },
  };
  const album = {
    id: 701,
    artistId: artist.id,
    title: "Selected Album",
    foreignAlbumId: "bcbcbcbc-bcbc-bcbc-bcbc-bcbcbcbcbcbc",
    monitored: false,
    statistics: {
      trackCount: 10,
      sizeOnDisk: 0,
      percentOfTracks: 0,
    },
  };
  fakeLidarr.state.artists.push(artist);
  fakeLidarr.state.albums.push(album);

  const { response, payload } = await apiFetch("/api/library/downloads/album", {
    method: "POST",
    body: JSON.stringify({
      artistId: String(artist.id),
      albumId: String(album.id),
      artistMbid: artist.foreignArtistId,
      artistName: artist.artistName,
    }),
  });

  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(fakeLidarr.state.updatedArtists.length, 1);
  assert.equal(fakeLidarr.state.updatedArtists[0].monitored, true);
  assert.equal(fakeLidarr.state.updatedArtists[0].monitor, "none");
  assert.equal(fakeLidarr.state.updatedArtists[0].monitorNewItems, "none");
  assert.equal(fakeLidarr.state.updatedAlbums.length, 1);
  assert.equal(fakeLidarr.state.updatedAlbums[0].monitored, true);

  const storedArtist = fakeLidarr.state.artists.find(
    (entry) => entry.id === artist.id,
  );
  assert.equal(storedArtist.monitored, true);
  assert.equal(storedArtist.monitor, "none");
  assert.equal(storedArtist.monitorNewItems, "none");
});

test("POST /library/downloads/album repairs monitoring after Lidarr search flips it off", async () => {
  await saveLidarrSettings({ defaultMonitorOption: "none", searchOnAdd: true });
  fakeLidarr.state.unmonitorAfterAlbumSearch = true;
  const artist = {
    id: 710,
    artistName: "Failed Search Artist",
    foreignArtistId: "cdcdcdcd-cdcd-cdcd-cdcd-cdcdcdcdcdcd",
    path: "/music/main/Failed Search Artist",
    added: new Date().toISOString(),
    monitored: true,
    monitor: "none",
    monitorNewItems: "none",
    addOptions: {
      monitor: "none",
    },
    qualityProfile: DEFAULT_QUALITY_PROFILES[0],
    statistics: {
      albumCount: 1,
      trackCount: 0,
      sizeOnDisk: 0,
    },
  };
  const album = {
    id: 711,
    artistId: artist.id,
    title: "Hard To Find Album",
    foreignAlbumId: "dededede-dede-dede-dede-dededededede",
    monitored: true,
    statistics: {
      trackCount: 10,
      sizeOnDisk: 0,
      percentOfTracks: 0,
    },
  };
  fakeLidarr.state.artists.push(artist);
  fakeLidarr.state.albums.push(album);

  const { response, payload } = await apiFetch("/api/library/downloads/album", {
    method: "POST",
    body: JSON.stringify({
      artistId: String(artist.id),
      albumId: String(album.id),
      artistMbid: artist.foreignArtistId,
      artistName: artist.artistName,
    }),
  });

  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(fakeLidarr.state.commands.length, 1);
  assert.equal(fakeLidarr.state.commands[0].name, "AlbumSearch");

  const storedArtist = fakeLidarr.state.artists.find(
    (entry) => entry.id === artist.id,
  );
  const storedAlbum = fakeLidarr.state.albums.find(
    (entry) => entry.id === album.id,
  );
  assert.equal(storedArtist.monitored, true);
  assert.equal(storedArtist.monitor, "none");
  assert.equal(storedArtist.monitorNewItems, "none");
  assert.equal(storedAlbum.monitored, true);
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
