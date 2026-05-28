import test from "node:test";
import assert from "node:assert/strict";
import fs from "fs/promises";
import path from "path";

import {
  createIsolatedStateDir,
  applyIsolatedBackendEnv,
  cleanupIsolatedState,
  importFromRepo,
  resetDatabase,
} from "../helpers/backendTestHarness.js";

const isolatedState = await createIsolatedStateDir("weekly-flow-file-reuse");
applyIsolatedBackendEnv(isolatedState);

const [{ db }, trackerModule, reuseModule] = await Promise.all([
  importFromRepo("backend/config/db-sqlite.js"),
  importFromRepo("backend/services/weeklyFlowDownloadTracker.js"),
  importFromRepo("backend/services/weeklyFlowFileReuse.js"),
]);

const { downloadTracker } = trackerModule;
const {
  normalizeExistingFileMode,
  reuseTrackForPlaylist,
  createPlaylistFileEntry,
} = reuseModule;

const weeklyFlowRoot = process.env.WEEKLY_FLOW_FOLDER;

test.beforeEach(async () => {
  await resetDatabase(db);
  downloadTracker.clearAll();
  await fs.rm(weeklyFlowRoot, { recursive: true, force: true });
});

test.after(async () => {
  await cleanupIsolatedState(isolatedState);
});

test("normalizeExistingFileMode accepts supported modes and defaults invalid values", () => {
  assert.equal(normalizeExistingFileMode("download"), "download");
  assert.equal(normalizeExistingFileMode("hardlink"), "hardlink");
  assert.equal(normalizeExistingFileMode("copy"), "copy");
  assert.equal(normalizeExistingFileMode(""), "hardlink");
  assert.equal(normalizeExistingFileMode("unsupported"), "hardlink");
});

test("reuseTrackForPlaylist hardlinks a completed Aurral track into the target playlist", async () => {
  const track = {
    artistName: "System of a Down",
    trackName: "Chop Suey",
    albumName: "Toxicity",
  };
  const sourcePath = path.join(
    weeklyFlowRoot,
    "aurral-weekly-flow",
    "source-playlist",
    "System of a Down",
    "Toxicity",
    "Chop Suey.flac",
  );
  await fs.mkdir(path.dirname(sourcePath), { recursive: true });
  await fs.writeFile(sourcePath, "audio");
  const sourceJobId = downloadTracker.addJob(track, "source-playlist");
  downloadTracker.setDone(sourceJobId, sourcePath, track.albumName);

  const result = await reuseTrackForPlaylist(track, "target-playlist", {
    existingFileMode: "hardlink",
    weeklyFlowRoot,
  });

  assert.equal(result.reused, true);
  assert.equal(result.sourceType, "aurral");
  assert.equal(result.linkType, "hardlink");
  assert.notEqual(result.finalPath, sourcePath);
  assert.equal(await fs.readFile(result.finalPath, "utf8"), "audio");

  const sourceStat = await fs.stat(sourcePath);
  const targetStat = await fs.stat(result.finalPath);
  assert.equal(targetStat.ino, sourceStat.ino);

  await fs.rm(result.finalPath, { force: true });
  assert.equal(await fs.readFile(sourcePath, "utf8"), "audio");
  assert.equal(downloadTracker.getJob(result.jobId)?.status, "done");
});

test("createPlaylistFileEntry can copy files directly", async () => {
  const sourcePath = path.join(weeklyFlowRoot, "source.mp3");
  const targetPath = path.join(weeklyFlowRoot, "target.mp3");
  await fs.mkdir(path.dirname(sourcePath), { recursive: true });
  await fs.writeFile(sourcePath, "audio");

  const result = await createPlaylistFileEntry(sourcePath, targetPath, "copy");

  assert.equal(result.linked, true);
  assert.equal(result.linkType, "copy");
  assert.equal(await fs.readFile(targetPath, "utf8"), "audio");
  const sourceStat = await fs.stat(sourcePath);
  const targetStat = await fs.stat(targetPath);
  assert.notEqual(targetStat.ino, sourceStat.ino);
});

test("reuseTrackForPlaylist does not inspect sources when reuse is disabled", async () => {
  const result = await reuseTrackForPlaylist(
    { artistName: "Artist", trackName: "Song", albumName: "Album" },
    "target-playlist",
    {
      existingFileMode: "download",
      weeklyFlowRoot,
    },
  );

  assert.equal(result.reused, false);
  assert.equal(downloadTracker.getAll().length, 0);
});
