import path from "path";
import fsp from "fs/promises";
import { libraryManager } from "./libraryManager.js";
import { downloadTracker } from "./weeklyFlowDownloadTracker.js";
import { weeklyFlowWorker } from "./weeklyFlowWorker.js";

const LINK_FALLBACK_ERROR_CODES = new Set([
  "EXDEV",
  "EPERM",
  "EACCES",
  "EMLINK",
  "ENOTSUP",
  "EOPNOTSUPP",
]);

const sanitizePathPart = (value) =>
  String(value || "")
    .replace(/[<>:"/\\|?*]/g, "_")
    .trim();

const isPathInsideRoot = (candidatePath, rootPath) => {
  const relative = path.relative(rootPath, candidatePath);
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
};

const getPlaylistLibraryRoot = (playlistId) =>
  path.resolve(
    weeklyFlowWorker.weeklyFlowRoot,
    "aurral-weekly-flow",
    String(playlistId || "").trim(),
  );

const buildUniqueTargetPath = async (track, playlistId, sourcePath, albumName = null) => {
  const ext = path.extname(sourcePath).toLowerCase();
  const artistDir = sanitizePathPart(track?.artistName || "Unknown Artist");
  const albumDir = sanitizePathPart(albumName || track?.albumName || "Unknown Album");
  const targetRoot = getPlaylistLibraryRoot(playlistId);
  let targetPath = path.resolve(
    targetRoot,
    artistDir,
    albumDir,
    `${sanitizePathPart(track?.trackName || "Unknown Track")}${ext}`,
  );
  if (!isPathInsideRoot(targetPath, targetRoot)) {
    throw new Error(`Target path is outside the playlist library: ${targetPath}`);
  }

  const parsed = path.parse(targetPath);
  let suffix = 1;
  while (true) {
    try {
      await fsp.access(targetPath);
      targetPath = path.resolve(
        parsed.dir,
        `${parsed.name}-${suffix}${parsed.ext}`,
      );
      suffix += 1;
    } catch {
      break;
    }
  }

  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  return targetPath;
};

export const findReusableLibraryTrack = async (track) =>
  libraryManager.findReusableTrack(track);

export const materializePlaylistTrackFromLibrary = async ({
  track,
  playlistId,
  sourcePath,
  albumName = null,
}) => {
  const safeSourcePath = path.resolve(sourcePath);
  const sourceStat = await fsp.stat(safeSourcePath);
  if (!sourceStat.isFile()) {
    throw new Error(`Library source is not a file: ${safeSourcePath}`);
  }

  const targetPath = await buildUniqueTargetPath(
    track,
    playlistId,
    safeSourcePath,
    albumName,
  );

  let mode = "hardlink";
  try {
    await fsp.link(safeSourcePath, targetPath);
  } catch (error) {
    if (!LINK_FALLBACK_ERROR_CODES.has(String(error?.code || ""))) {
      throw error;
    }
    await fsp.copyFile(safeSourcePath, targetPath);
    mode = "copy-fallback";
  }

  return { targetPath, mode, safeSourcePath };
};

export const reuseTrackForStaticPlaylist = async (track, playlistId) => {
  const match = await findReusableLibraryTrack(track);
  if (!match?.path) {
    console.log(
      `[StaticPlaylistReuse] No library match for ${playlistId}: ${track?.artistName || "Unknown Artist"} - ${track?.trackName || "Unknown Track"}`,
    );
    return null;
  }

  let stat = null;
  try {
    stat = await fsp.stat(path.resolve(match.path));
  } catch {
    stat = null;
  }
  if (!stat?.isFile()) {
    console.warn(
      `[StaticPlaylistReuse] Library match missing on disk for ${playlistId}: ${match.path}`,
    );
    return null;
  }

  console.log(
    `[StaticPlaylistReuse] Library match for ${playlistId}: ${track.artistName} - ${track.trackName} <- ${match.path}`,
  );

  const { targetPath, mode, safeSourcePath } =
    await materializePlaylistTrackFromLibrary({
      track,
      playlistId,
      sourcePath: match.path,
      albumName: match.albumName || track?.albumName || null,
    });

  const jobId = downloadTracker.addJob(track, playlistId);
  if (!jobId) {
    await fsp.rm(targetPath, { force: true }).catch(() => {});
    return null;
  }

  downloadTracker.setDone(
    jobId,
    targetPath,
    match.albumName || track?.albumName || null,
  );

  console.log(
    `[StaticPlaylistReuse] Materialized ${mode} for ${playlistId}: ${track.artistName} - ${track.trackName} (${safeSourcePath} -> ${targetPath})`,
  );

  return {
    jobId,
    targetPath,
    mode,
    match,
  };
};
