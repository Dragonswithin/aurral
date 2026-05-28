import test from "node:test";
import assert from "node:assert/strict";

import {
  matchesAlbumReleaseTypeFilter,
  normalizeAlbumSearchItem,
  normalizeAlbumReleaseTypesFilter,
  normalizeArtistSearchItem,
} from "../../backend/services/searchService.js";
import { libraryManager } from "../../backend/services/libraryManager.js";
import { lidarrClient } from "../../backend/services/lidarrClient.js";

test("normalizeArtistSearchItem preserves sort name and cached image", () => {
  const item = normalizeArtistSearchItem(
    {
      id: "artist-mbid",
      name: "Boards of Canada",
      "sort-name": "Canada, Boards of",
    },
    {
      "artist-mbid": { imageUrl: "https://images.example/artist.jpg" },
    },
  );

  assert.equal(item.type, "artist");
  assert.equal(item.id, "artist-mbid");
  assert.equal(item.name, "Boards of Canada");
  assert.equal(item.sortName, "Canada, Boards of");
  assert.equal(item.image, "https://images.example/artist.jpg");
  assert.equal(item.imageUrl, item.image);
  assert.equal(item.artistType, null);
  assert.equal(item.country, null);
  assert.equal(item.area, null);
  assert.equal(item.begin, null);
  assert.equal(item.end, null);
  assert.equal(item.disambiguation, null);
  assert.equal(item.inLibrary, false);
});

test("normalizeAlbumSearchItem preserves compilation metadata and library state", () => {
  const item = normalizeAlbumSearchItem(
    {
      id: "release-group-mbid",
      title: "Chrono Trigger Original Sound Version",
      "artist-credit": [
        {
          name: "Various Artists",
          artist: { id: "various-artists-mbid", name: "Various Artists" },
        },
      ],
      "first-release-date": "1995-03-11",
      "primary-type": "Album",
      "secondary-types": ["Soundtrack", "Compilation"],
    },
    {
      libraryAlbumId: "42",
      libraryArtistId: "7",
      status: "inLibrary",
    },
  );

  assert.deepEqual(item, {
    type: "album",
    id: "release-group-mbid",
    title: "Chrono Trigger Original Sound Version",
    artistName: "Various Artists",
    artistMbid: "various-artists-mbid",
    releaseDate: "1995-03-11",
    primaryType: "Album",
    secondaryTypes: ["Soundtrack", "Compilation"],
    coverUrl: null,
    inLibrary: true,
    libraryAlbumId: "42",
    libraryArtistId: "7",
    status: "inLibrary",
  });
});

test("normalizeAlbumReleaseTypesFilter removes invalid and duplicate release types", () => {
  assert.deepEqual(
    normalizeAlbumReleaseTypesFilter("Album,Live,Album,Invalid"),
    ["Album", "Live"],
  );
});

test("matchesAlbumReleaseTypeFilter requires selected primary and secondary types", () => {
  assert.equal(
    matchesAlbumReleaseTypeFilter(
      {
        "primary-type": "Album",
        "secondary-types": ["Live", "Soundtrack"],
      },
      ["Album", "Live", "Soundtrack"],
    ),
    true,
  );
  assert.equal(
    matchesAlbumReleaseTypeFilter(
      {
        "primary-type": "Album",
        "secondary-types": ["Live", "Soundtrack"],
      },
      ["Album", "Live"],
    ),
    false,
  );
});

test("requestAlbumFromSearch resolves artist add settings and triggers search", async () => {
  const originalIsConfigured = lidarrClient.isConfigured;
  const originalGetAlbumByMbid = lidarrClient.getAlbumByMbid;
  const originalGetArtist = libraryManager.getArtist;
  const originalResolveArtistAddOptions = libraryManager.resolveArtistAddOptions;
  const originalAddArtistWithResolvedOptions =
    libraryManager.addArtistWithResolvedOptions;
  const originalWaitForAlbumByMbidForArtist =
    libraryManager.waitForAlbumByMbidForArtist;
  const originalAddAlbum = libraryManager.addAlbum;

  lidarrClient.isConfigured = () => true;
  lidarrClient.getAlbumByMbid = async () => null;
  libraryManager.getArtist = async () => null;
  libraryManager.resolveArtistAddOptions = async () => ({
    quality: "standard",
    monitorOption: "none",
    rootFolderPath: "/music/main",
    qualityProfileId: 7,
  });
  libraryManager.addArtistWithResolvedOptions = async (
    _mbid,
    _name,
    options = {},
  ) => ({
    id: "7",
    mbid: "artist-mbid",
    foreignArtistId: "artist-mbid",
    artistName: "Various Artists",
    monitorOption: options.monitorOption,
  });
  libraryManager.waitForAlbumByMbidForArtist = async () => null;
  libraryManager.addAlbum = async () => ({
    id: "42",
    artistId: "7",
    mbid: "album-mbid",
    foreignAlbumId: "album-mbid",
    albumName: "Chrono Trigger",
    monitored: true,
    statistics: {
      percentOfTracks: 0,
      sizeOnDisk: 0,
    },
  });

  try {
    const result = await libraryManager.requestAlbumFromSearch({
      albumMbid: "album-mbid",
      albumName: "Chrono Trigger",
      artistMbid: "artist-mbid",
      artistName: "Various Artists",
      triggerSearch: true,
      user: {
        role: "user",
        permissions: { addAlbum: true, addArtist: true },
      },
    });

    assert.equal(result.success, true);
    assert.equal(result.createdArtist, true);
    assert.equal(result.createdAlbum, true);
    assert.equal(result.triggeredSearch, true);
    assert.equal(result.status, "searching");
    assert.equal(result.artist.id, "7");
    assert.equal(result.album.id, "42");
    assert.equal(result.artist.monitorOption, "none");
  } finally {
    lidarrClient.isConfigured = originalIsConfigured;
    lidarrClient.getAlbumByMbid = originalGetAlbumByMbid;
    libraryManager.getArtist = originalGetArtist;
    libraryManager.resolveArtistAddOptions = originalResolveArtistAddOptions;
    libraryManager.addArtistWithResolvedOptions =
      originalAddArtistWithResolvedOptions;
    libraryManager.waitForAlbumByMbidForArtist =
      originalWaitForAlbumByMbidForArtist;
    libraryManager.addAlbum = originalAddAlbum;
  }
});

test("requestAlbumFromSearch waits for Lidarr to populate a new artist album", async () => {
  const originalIsConfigured = lidarrClient.isConfigured;
  const originalGetAlbumByMbid = lidarrClient.getAlbumByMbid;
  const originalGetArtist = libraryManager.getArtist;
  const originalResolveArtistAddOptions = libraryManager.resolveArtistAddOptions;
  const originalAddArtistWithResolvedOptions =
    libraryManager.addArtistWithResolvedOptions;
  const originalWaitForAlbumByMbidForArtist =
    libraryManager.waitForAlbumByMbidForArtist;
  const originalAddAlbum = libraryManager.addAlbum;

  let waitCall = null;

  lidarrClient.isConfigured = () => true;
  lidarrClient.getAlbumByMbid = async () => null;
  libraryManager.getArtist = async () => null;
  libraryManager.resolveArtistAddOptions = async () => ({
    quality: "standard",
    monitorOption: "none",
    rootFolderPath: "/music/main",
    qualityProfileId: 7,
  });
  libraryManager.addArtistWithResolvedOptions = async () => ({
    id: "7",
    mbid: "artist-mbid",
    foreignArtistId: "artist-mbid",
    artistName: "Boards of Canada",
    monitorOption: "none",
  });
  libraryManager.waitForAlbumByMbidForArtist = async (albumMbid, artistId) => {
    waitCall = { albumMbid, artistId };
    return {
      id: 42,
      artistId: 7,
      foreignAlbumId: "album-mbid",
      title: "Geogaddi",
    };
  };
  libraryManager.addAlbum = async (artistId, albumMbid, albumName, options) => {
    assert.deepEqual(waitCall, {
      albumMbid: "album-mbid",
      artistId: "7",
    });
    assert.equal(artistId, "7");
    assert.equal(albumMbid, "album-mbid");
    assert.equal(albumName, "Geogaddi");
    assert.equal(options.triggerSearch, true);
    return {
      id: "42",
      artistId: "7",
      mbid: "album-mbid",
      foreignAlbumId: "album-mbid",
      albumName: "Geogaddi",
      monitored: true,
      statistics: {
        percentOfTracks: 0,
        sizeOnDisk: 0,
      },
    };
  };

  try {
    const result = await libraryManager.requestAlbumFromSearch({
      albumMbid: "album-mbid",
      albumName: "Geogaddi",
      artistMbid: "artist-mbid",
      artistName: "Boards of Canada",
      triggerSearch: true,
      user: {
        role: "user",
        permissions: { addAlbum: true, addArtist: true },
      },
    });

    assert.equal(result.success, true);
    assert.equal(result.createdArtist, true);
    assert.equal(result.createdAlbum, false);
    assert.equal(result.triggeredSearch, true);
    assert.equal(result.album.id, "42");
  } finally {
    lidarrClient.isConfigured = originalIsConfigured;
    lidarrClient.getAlbumByMbid = originalGetAlbumByMbid;
    libraryManager.getArtist = originalGetArtist;
    libraryManager.resolveArtistAddOptions = originalResolveArtistAddOptions;
    libraryManager.addArtistWithResolvedOptions =
      originalAddArtistWithResolvedOptions;
    libraryManager.waitForAlbumByMbidForArtist =
      originalWaitForAlbumByMbidForArtist;
    libraryManager.addAlbum = originalAddAlbum;
  }
});

test("requestAlbumFromSearch rejects when artist must be created without addArtist permission", async () => {
  const originalIsConfigured = lidarrClient.isConfigured;
  const originalGetArtist = libraryManager.getArtist;

  lidarrClient.isConfigured = () => true;
  libraryManager.getArtist = async () => null;

  try {
    await assert.rejects(
      () =>
        libraryManager.requestAlbumFromSearch({
          albumMbid: "album-mbid",
          albumName: "Chrono Trigger",
          artistMbid: "artist-mbid",
          artistName: "Various Artists",
          user: {
            role: "user",
            permissions: { addAlbum: true, addArtist: false },
          },
        }),
      (error) => {
        assert.equal(error.statusCode, 403);
        assert.match(error.message, /Permission required: addArtist/);
        return true;
      },
    );
  } finally {
    lidarrClient.isConfigured = originalIsConfigured;
    libraryManager.getArtist = originalGetArtist;
  }
});

test("addAlbum checks artist monitoring while monitoring only the requested album", async () => {
  const originalIsConfigured = lidarrClient.isConfigured;
  const originalGetArtist = lidarrClient.getArtist;
  const originalGetAlbumByMbid = lidarrClient.getAlbumByMbid;
  const originalAddAlbum = lidarrClient.addAlbum;
  const originalUpdateArtistMonitoring = lidarrClient.updateArtistMonitoring;

  let updateArtistMonitoringCalls = 0;

  lidarrClient.isConfigured = () => true;
  lidarrClient.getArtist = async () => ({
    id: 7,
    artistName: "Boards of Canada",
    foreignArtistId: "artist-mbid",
    monitored: false,
    monitor: "none",
  });
  lidarrClient.getAlbumByMbid = async () => null;
  lidarrClient.addAlbum = async () => ({
    id: 42,
    artistId: 7,
    foreignAlbumId: "album-mbid",
    title: "Geogaddi",
    monitored: true,
    statistics: {
      percentOfTracks: 0,
      sizeOnDisk: 0,
    },
  });
  lidarrClient.updateArtistMonitoring = async (_artistId, monitorOption) => {
    updateArtistMonitoringCalls += 1;
    assert.equal(monitorOption, "none");
    return {
      id: 7,
      artistName: "Boards of Canada",
      foreignArtistId: "artist-mbid",
      monitored: true,
      monitor: "none",
      monitorNewItems: "none",
      addOptions: {
        monitor: "none",
      },
    };
  };

  try {
    const album = await libraryManager.addAlbum(7, "album-mbid", "Geogaddi");
    assert.equal(album.id, "42");
    assert.equal(updateArtistMonitoringCalls, 1);
  } finally {
    lidarrClient.isConfigured = originalIsConfigured;
    lidarrClient.getArtist = originalGetArtist;
    lidarrClient.getAlbumByMbid = originalGetAlbumByMbid;
    lidarrClient.addAlbum = originalAddAlbum;
    lidarrClient.updateArtistMonitoring = originalUpdateArtistMonitoring;
  }
});

test("addAlbum monitors and searches the requested album after Lidarr conflict lag", async () => {
  const originalIsConfigured = lidarrClient.isConfigured;
  const originalGetArtist = lidarrClient.getArtist;
  const originalGetAlbumByMbid = lidarrClient.getAlbumByMbid;
  const originalAddAlbum = lidarrClient.addAlbum;
  const originalGetAlbum = lidarrClient.getAlbum;
  const originalMonitorAlbum = lidarrClient.monitorAlbum;
  const originalTriggerAlbumSearch = lidarrClient.triggerAlbumSearch;
  const originalUpdateArtistMonitoring = lidarrClient.updateArtistMonitoring;
  const originalWaitForAlbumByMbidForArtist =
    libraryManager.waitForAlbumByMbidForArtist;

  let monitorCalls = 0;
  let searchCalls = 0;
  let updateArtistMonitoringCalls = 0;

  lidarrClient.isConfigured = () => true;
  lidarrClient.getArtist = async () => ({
    id: 7,
    artistName: "Boards of Canada",
    foreignArtistId: "artist-mbid",
    monitored: false,
    monitor: "none",
  });
  lidarrClient.getAlbumByMbid = async () => null;
  lidarrClient.updateArtistMonitoring = async (_artistId, monitorOption) => {
    updateArtistMonitoringCalls += 1;
    assert.equal(monitorOption, "none");
    return {
      id: 7,
      artistName: "Boards of Canada",
      foreignArtistId: "artist-mbid",
      monitored: true,
      monitor: "none",
    };
  };
  lidarrClient.addAlbum = async () => {
    throw new Error("AlbumExistsValidator: This album has already been added");
  };
  libraryManager.waitForAlbumByMbidForArtist = async () => ({
    id: 42,
    artistId: "7",
    foreignAlbumId: "album-mbid",
    title: "Geogaddi",
    monitored: false,
    statistics: {
      percentOfTracks: 0,
      sizeOnDisk: 0,
    },
  });
  lidarrClient.monitorAlbum = async (albumId, monitored) => {
    monitorCalls += 1;
    assert.equal(albumId, 42);
    assert.equal(monitored, true);
  };
  lidarrClient.triggerAlbumSearch = async (albumId) => {
    searchCalls += 1;
    assert.equal(albumId, 42);
  };
  lidarrClient.getAlbum = async () => ({
    id: 42,
    artistId: 7,
    foreignAlbumId: "album-mbid",
    title: "Geogaddi",
    monitored: true,
    statistics: {
      percentOfTracks: 0,
      sizeOnDisk: 0,
    },
  });

  try {
    const album = await libraryManager.addAlbum(7, "album-mbid", "Geogaddi", {
      triggerSearch: true,
    });

    assert.equal(album.id, "42");
    assert.equal(album.monitored, true);
    assert.equal(updateArtistMonitoringCalls, 1);
    assert.equal(monitorCalls, 1);
    assert.equal(searchCalls, 1);
  } finally {
    lidarrClient.isConfigured = originalIsConfigured;
    lidarrClient.getArtist = originalGetArtist;
    lidarrClient.getAlbumByMbid = originalGetAlbumByMbid;
    lidarrClient.addAlbum = originalAddAlbum;
    lidarrClient.getAlbum = originalGetAlbum;
    lidarrClient.monitorAlbum = originalMonitorAlbum;
    lidarrClient.triggerAlbumSearch = originalTriggerAlbumSearch;
    lidarrClient.updateArtistMonitoring = originalUpdateArtistMonitoring;
    libraryManager.waitForAlbumByMbidForArtist =
      originalWaitForAlbumByMbidForArtist;
  }
});
