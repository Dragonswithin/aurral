import test from "node:test";
import assert from "node:assert/strict";

import { dbOps } from "../backend/config/db-helpers.js";
import { defaultData } from "../backend/config/constants.js";
import {
  __setMetadataProviderHealthStateForTests,
  getMetadataProviderHealthSnapshot,
  getCoverArtArchiveApiBaseUrls,
  getCoverArtArchiveApiBaseUrl,
  getMusicbrainzApiBaseUrls,
  getMusicbrainzApiBaseUrl,
} from "../backend/services/apiClients.js";

const originalSettings = dbOps.getSettings();

test.after(() => {
  dbOps.updateSettings(originalSettings);
  __setMetadataProviderHealthStateForTests("musicbrainz");
});

test("default settings use hosted MusicBrainz and official Cover Art Archive", () => {
  assert.equal(
    defaultData.settings.integrations.musicbrainz.provider,
    "aurralHosted",
  );
  assert.equal(getCoverArtArchiveApiBaseUrl(), "https://coverartarchive.org");
});

test("backend metadata providers default to hosted MusicBrainz when unset", () => {
  dbOps.updateSettings({
    ...originalSettings,
    integrations: {
      ...(originalSettings.integrations || {}),
      musicbrainz: { email: "test@example.com" },
    },
  });

  assert.equal(
    getMusicbrainzApiBaseUrl(),
    "https://mb.lkly.net/ws/2",
  );
  assert.equal(getCoverArtArchiveApiBaseUrl(), "https://coverartarchive.org");
});

test("MusicBrainz hosted mode stays pinned to hosted by default", () => {
  dbOps.updateSettings({
    ...originalSettings,
    integrations: {
      ...(originalSettings.integrations || {}),
      musicbrainz: {
        email: "test@example.com",
        provider: "aurralHosted",
        customUrl: "",
      },
    },
  });

  assert.deepEqual(getMusicbrainzApiBaseUrls(), ["https://mb.lkly.net/ws/2"]);
  assert.deepEqual(getCoverArtArchiveApiBaseUrls(), ["https://coverartarchive.org"]);
});

test("automatic provider failover only changes the MusicBrainz base after hosted health degrades", () => {
  dbOps.updateSettings({
    ...originalSettings,
    integrations: {
      ...(originalSettings.integrations || {}),
      musicbrainz: {
        email: "test@example.com",
        provider: "aurralHosted",
        customUrl: "",
      },
    },
  });

  __setMetadataProviderHealthStateForTests("musicbrainz", {
    failoverActive: true,
    consecutiveFailures: 3,
    lastFailureReason: "HTTP 503",
  });

  assert.equal(getMusicbrainzApiBaseUrl(), "https://musicbrainz.org/ws/2");
  assert.equal(getCoverArtArchiveApiBaseUrl(), "https://coverartarchive.org");

  const snapshot = getMetadataProviderHealthSnapshot();
  assert.equal(snapshot.musicbrainz.mode, "auto");
  assert.equal(snapshot.musicbrainz.activeProvider, "official");
  assert.equal(snapshot.musicbrainz.failoverActive, true);
  assert.equal(snapshot.musicbrainz.lastFailureReason, "HTTP 503");
});

test("manual MusicBrainz provider selection bypasses automatic failover state", () => {
  dbOps.updateSettings({
    ...originalSettings,
    integrations: {
      ...(originalSettings.integrations || {}),
      musicbrainz: {
        email: "test@example.com",
        provider: "official",
        customUrl: "",
      },
    },
  });

  __setMetadataProviderHealthStateForTests("musicbrainz", {
    failoverActive: true,
    consecutiveFailures: 5,
  });

  assert.deepEqual(getMusicbrainzApiBaseUrls(), ["https://musicbrainz.org/ws/2"]);
  assert.deepEqual(getCoverArtArchiveApiBaseUrls(), [
    "https://coverartarchive.org",
  ]);

  const snapshot = getMetadataProviderHealthSnapshot();
  assert.equal(snapshot.musicbrainz.mode, "manual");
  assert.equal(snapshot.musicbrainz.activeProvider, "official");
  assert.equal(snapshot.musicbrainz.failoverActive, false);
});
