import test from "node:test";
import assert from "node:assert/strict";
import os from "os";
import path from "path";
import fsp from "fs/promises";

const makeTrack = () => ({
  artistName: "Test Artist",
  trackName: "Test Track",
  albumName: "Test Album",
  artistMbid: "artist-mbid-1",
  albumMbid: "album-mbid-1",
  trackMbid: "track-mbid-1",
  releaseYear: "2024",
  durationMs: 123000,
  artistAliases: [],
  reason: null,
});

test("reuseTrackForStaticPlaylist hardlinks a matched Lidarr track into playlist storage", async () => {
  const tempDataDir = await fsp.mkdtemp(
    path.join(os.tmpdir(), "aurral-reuse-data-"),
  );
  const tempRoot = await fsp.mkdtemp(
    path.join(os.tmpdir(), "aurral-reuse-root-"),
  );
  process.env.AURRAL_DATA_DIR = tempDataDir;

  const [{ reuseTrackForStaticPlaylist }, { libraryManager }, { downloadTracker }, { weeklyFlowWorker }] =
    await Promise.all([
      import("../services/staticPlaylistLibraryReuse.js"),
      import("../services/libraryManager.js"),
      import("../services/weeklyFlowDownloadTracker.js"),
      import("../services/weeklyFlowWorker.js"),
    ]);

  const sourceDir = path.join(tempRoot, "lidarr-library", "Test Artist", "Test Album");
  const sourcePath = path.join(sourceDir, "01 Test Track.flac");
  await fsp.mkdir(sourceDir, { recursive: true });
  await fsp.writeFile(sourcePath, "audio-bytes");

  const originalFindReusableTrack = libraryManager.findReusableTrack;
  const originalWeeklyFlowRoot = weeklyFlowWorker.weeklyFlowRoot;
  const originalAddJob = downloadTracker.addJob;
  const originalSetDone = downloadTracker.setDone;

  const setDoneCalls = [];
  weeklyFlowWorker.weeklyFlowRoot = tempRoot;
  libraryManager.findReusableTrack = async () => ({
    path: sourcePath,
    artistName: "Test Artist",
    trackName: "Test Track",
    albumName: "Test Album",
    trackMbid: "track-mbid-1",
    size: 11,
    hasFile: true,
    releaseYear: "2024",
  });
  downloadTracker.addJob = () => "job-1";
  downloadTracker.setDone = (...args) => {
    setDoneCalls.push(args);
    return true;
  };

  try {
    const result = await reuseTrackForStaticPlaylist(makeTrack(), "playlist-1");

    assert.ok(result);
    assert.equal(result.jobId, "job-1");
    assert.equal(result.mode, "hardlink");
    assert.equal(setDoneCalls.length, 1);
    assert.equal(setDoneCalls[0][0], "job-1");
    assert.equal(setDoneCalls[0][2], "Test Album");

    const sourceStat = await fsp.stat(sourcePath);
    const targetStat = await fsp.stat(result.targetPath);
    assert.equal(sourceStat.ino, targetStat.ino);
    assert.ok(sourceStat.nlink >= 2);

    await fsp.rm(result.targetPath, { force: true });
    const sourceAfterDelete = await fsp.readFile(sourcePath, "utf8");
    assert.equal(sourceAfterDelete, "audio-bytes");
  } finally {
    libraryManager.findReusableTrack = originalFindReusableTrack;
    weeklyFlowWorker.weeklyFlowRoot = originalWeeklyFlowRoot;
    downloadTracker.addJob = originalAddJob;
    downloadTracker.setDone = originalSetDone;
    await fsp.rm(tempRoot, { recursive: true, force: true });
    await fsp.rm(tempDataDir, { recursive: true, force: true });
  }
});

test("reuseTrackForStaticPlaylist falls back to copy when hardlinking is unsupported", async () => {
  const tempDataDir = await fsp.mkdtemp(
    path.join(os.tmpdir(), "aurral-reuse-data-"),
  );
  const tempRoot = await fsp.mkdtemp(
    path.join(os.tmpdir(), "aurral-reuse-root-"),
  );
  process.env.AURRAL_DATA_DIR = tempDataDir;

  const fspModule = (await import("fs/promises")).default;
  const [{ reuseTrackForStaticPlaylist }, { libraryManager }, { downloadTracker }, { weeklyFlowWorker }] =
    await Promise.all([
      import("../services/staticPlaylistLibraryReuse.js"),
      import("../services/libraryManager.js"),
      import("../services/weeklyFlowDownloadTracker.js"),
      import("../services/weeklyFlowWorker.js"),
    ]);

  const sourceDir = path.join(tempRoot, "lidarr-library", "Test Artist", "Test Album");
  const sourcePath = path.join(sourceDir, "01 Test Track.flac");
  await fsp.mkdir(sourceDir, { recursive: true });
  await fsp.writeFile(sourcePath, "audio-bytes");

  const originalFindReusableTrack = libraryManager.findReusableTrack;
  const originalWeeklyFlowRoot = weeklyFlowWorker.weeklyFlowRoot;
  const originalAddJob = downloadTracker.addJob;
  const originalSetDone = downloadTracker.setDone;
  const originalLink = fspModule.link;

  weeklyFlowWorker.weeklyFlowRoot = tempRoot;
  libraryManager.findReusableTrack = async () => ({
    path: sourcePath,
    artistName: "Test Artist",
    trackName: "Test Track",
    albumName: "Test Album",
    trackMbid: "track-mbid-1",
    size: 11,
    hasFile: true,
    releaseYear: "2024",
  });
  downloadTracker.addJob = () => "job-2";
  downloadTracker.setDone = () => true;
  fspModule.link = async () => {
    const error = new Error("Cross-device link not permitted");
    error.code = "EXDEV";
    throw error;
  };

  try {
    const result = await reuseTrackForStaticPlaylist(makeTrack(), "playlist-2");

    assert.ok(result);
    assert.equal(result.jobId, "job-2");
    assert.equal(result.mode, "copy-fallback");

    const sourceStat = await fsp.stat(sourcePath);
    const targetStat = await fsp.stat(result.targetPath);
    assert.notEqual(sourceStat.ino, targetStat.ino);
    assert.equal(await fsp.readFile(result.targetPath, "utf8"), "audio-bytes");
  } finally {
    libraryManager.findReusableTrack = originalFindReusableTrack;
    weeklyFlowWorker.weeklyFlowRoot = originalWeeklyFlowRoot;
    downloadTracker.addJob = originalAddJob;
    downloadTracker.setDone = originalSetDone;
    fspModule.link = originalLink;
    await fsp.rm(tempRoot, { recursive: true, force: true });
    await fsp.rm(tempDataDir, { recursive: true, force: true });
  }
});
