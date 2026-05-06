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
  __setMetadataProviderHealthStateForTests("coverArtArchive");
});

test("default settings use hosted metadata providers", () => {
  assert.equal(
    defaultData.settings.integrations.musicbrainz.provider,
    "aurralHosted",
  );
  assert.equal(
    defaultData.settings.integrations.coverArtArchive.provider,
    "aurralHosted",
  );
});

test("backend metadata providers default to hosted when unset", () => {
  dbOps.updateSettings({
    ...originalSettings,
    integrations: {
      ...(originalSettings.integrations || {}),
      musicbrainz: { email: "test@example.com" },
      coverArtArchive: {},
    },
  });

  assert.equal(
    getMusicbrainzApiBaseUrl(),
    "https://mb.lkly.net/ws/2",
  );
  assert.equal(
    getCoverArtArchiveApiBaseUrl(),
    "https://caa.lkly.net",
  );
});

test("hosted metadata providers stay pinned to hosted by default", () => {
  dbOps.updateSettings({
    ...originalSettings,
    integrations: {
      ...(originalSettings.integrations || {}),
      musicbrainz: {
        email: "test@example.com",
        provider: "aurralHosted",
        customUrl: "",
      },
      coverArtArchive: {
        provider: "aurralHosted",
        customUrl: "",
      },
    },
  });

  assert.deepEqual(getMusicbrainzApiBaseUrls(), ["https://mb.lkly.net/ws/2"]);
  assert.deepEqual(getCoverArtArchiveApiBaseUrls(), ["https://caa.lkly.net"]);
});

test("automatic provider failover only changes the active base after hosted health degrades", () => {
  dbOps.updateSettings({
    ...originalSettings,
    integrations: {
      ...(originalSettings.integrations || {}),
      musicbrainz: {
        email: "test@example.com",
        provider: "aurralHosted",
        customUrl: "",
      },
      coverArtArchive: {
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
  __setMetadataProviderHealthStateForTests("coverArtArchive", {
    failoverActive: true,
    consecutiveFailures: 3,
    lastFailureReason: "ETIMEDOUT",
  });

  assert.equal(getMusicbrainzApiBaseUrl(), "https://musicbrainz.org/ws/2");
  assert.equal(getCoverArtArchiveApiBaseUrl(), "https://coverartarchive.org");

  const snapshot = getMetadataProviderHealthSnapshot();
  assert.equal(snapshot.musicbrainz.mode, "auto");
  assert.equal(snapshot.musicbrainz.activeProvider, "official");
  assert.equal(snapshot.musicbrainz.failoverActive, true);
  assert.equal(snapshot.musicbrainz.lastFailureReason, "HTTP 503");
  assert.equal(snapshot.coverArtArchive.activeProvider, "official");
  assert.equal(snapshot.coverArtArchive.failoverActive, true);
  assert.equal(snapshot.coverArtArchive.lastFailureReason, "ETIMEDOUT");
});

test("manual official and custom provider selections bypass automatic failover state", () => {
  dbOps.updateSettings({
    ...originalSettings,
    integrations: {
      ...(originalSettings.integrations || {}),
      musicbrainz: {
        email: "test@example.com",
        provider: "official",
        customUrl: "",
      },
      coverArtArchive: {
        provider: "custom",
        customUrl: "https://covers.example.net/api",
      },
    },
  });

  __setMetadataProviderHealthStateForTests("musicbrainz", {
    failoverActive: true,
    consecutiveFailures: 5,
  });
  __setMetadataProviderHealthStateForTests("coverArtArchive", {
    failoverActive: true,
    consecutiveFailures: 5,
  });

  assert.deepEqual(getMusicbrainzApiBaseUrls(), ["https://musicbrainz.org/ws/2"]);
  assert.deepEqual(getCoverArtArchiveApiBaseUrls(), [
    "https://covers.example.net/api",
  ]);

  const snapshot = getMetadataProviderHealthSnapshot();
  assert.equal(snapshot.musicbrainz.mode, "manual");
  assert.equal(snapshot.musicbrainz.activeProvider, "official");
  assert.equal(snapshot.musicbrainz.failoverActive, false);
  assert.equal(snapshot.coverArtArchive.mode, "manual");
  assert.equal(snapshot.coverArtArchive.activeProvider, "custom");
  assert.equal(snapshot.coverArtArchive.activeBaseUrl, "https://covers.example.net/api");
  assert.equal(snapshot.coverArtArchive.failoverActive, false);
});
