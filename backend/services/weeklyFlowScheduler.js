import { downloadTracker } from "./weeklyFlowDownloadTracker.js";
import { weeklyFlowWorker } from "./weeklyFlowWorker.js";
import { playlistManager } from "./weeklyFlowPlaylistManager.js";
import { flowPlaylistConfig } from "./weeklyFlowPlaylistConfig.js";
import { soulseekClient } from "./simpleSoulseekClient.js";
import { weeklyFlowOperationQueue } from "./weeklyFlowOperationQueue.js";

export async function runScheduledRefresh() {
  if (!soulseekClient.isConfigured()) return;

  const due = flowPlaylistConfig.getDueForRefresh();
  if (due.length === 0) return;

  for (const flow of due) {
    try {
      await weeklyFlowOperationQueue.enqueue(
        `scheduled:${flow.id}`,
        async () => {
          if (!flowPlaylistConfig.isEnabled(flow.id)) return;
          const flowStats = downloadTracker.getPlaylistTypeStats(flow.id);
          const shouldStopWorker =
            weeklyFlowWorker.running &&
            (flowStats.pending > 0 || flowStats.downloading > 0);
          if (shouldStopWorker) {
            weeklyFlowWorker.stop();
          }
          weeklyFlowWorker.clearIncompleteRetry(flow.id);
          weeklyFlowWorker.clearPlaylistRunState(flow.id);
          playlistManager.updateConfig(false);
          await playlistManager.weeklyReset([flow.id]);
          downloadTracker.clearByPlaylistType(flow.id);

          const latestFlow = flowPlaylistConfig.getFlow(flow.id);
          if (!latestFlow || !latestFlow.enabled) return;
          const seeded = await weeklyFlowWorker.seedFlowRun(flow.id, latestFlow);
          if (Number(seeded?.tracksQueued || 0) === 0) {
            flowPlaylistConfig.scheduleNextRun(flow.id);
            if (shouldStopWorker) {
              const stillPending = downloadTracker.getNextPending();
              if (stillPending && !weeklyFlowWorker.running) {
                await weeklyFlowWorker.start();
              }
            }
            return;
          }

          if (!weeklyFlowWorker.running) {
            await weeklyFlowWorker.start();
          } else {
            weeklyFlowWorker.wake();
          }
          flowPlaylistConfig.scheduleNextRun(flow.id);
          console.log(
            `[WeeklyFlowScheduler] Refreshed ${flow.id} (${Number(seeded?.tracksQueued || 0)} tracks, ${Number(seeded?.reserveTracks || 0)} reserve)`,
          );
        },
      );
    } catch (error) {
      console.error(
        `[WeeklyFlowScheduler] Failed to refresh ${flow.id}:`,
        error.message,
      );
    }
  }
}

export async function startWorkerIfPending() {
  const pending = downloadTracker.getNextPending();
  if (pending) {
    if (weeklyFlowWorker.running) {
      weeklyFlowWorker.wake();
      return;
    }
    await weeklyFlowWorker.start();
    return;
  }
  const flowIds = flowPlaylistConfig
    .getFlows()
    .filter((flow) => flow?.enabled === true)
    .map((flow) => flow.id);
  const sharedIds = flowPlaylistConfig
    .getSharedPlaylists()
    .map((playlist) => playlist.id);
  const playlistIds = [...new Set([...flowIds, ...sharedIds])];
  for (const playlistId of playlistIds) {
    await weeklyFlowWorker.retryIncompletePlaylist(playlistId);
  }
}
