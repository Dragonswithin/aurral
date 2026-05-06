import test from "node:test";
import assert from "node:assert/strict";

import { dbOps } from "../backend/config/db-helpers.js";
import { defaultData } from "../backend/config/constants.js";
import {
  getCoverArtArchiveApiBaseUrls,
  getCoverArtArchiveApiBaseUrl,
  getMusicbrainzApiBaseUrls,
  getMusicbrainzApiBaseUrl,
} from "../backend/services/apiClients.js";

const originalSettings = dbOps.getSettings();

test.after(() => {
  dbOps.updateSettings(originalSettings);
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

test("hosted metadata providers include public fallbacks", () => {
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

  assert.deepEqual(getMusicbrainzApiBaseUrls(), [
    "https://mb.lkly.net/ws/2",
    "https://musicbrainz.org/ws/2",
  ]);
  assert.deepEqual(getCoverArtArchiveApiBaseUrls(), [
    "https://caa.lkly.net",
    "https://coverartarchive.org",
  ]);
});
