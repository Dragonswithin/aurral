import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import {
  Loader,
  Clock,
  CheckCircle2,
  AlertCircle,
  X,
  Music,
  RefreshCw,
} from "lucide-react";
import {
  getRequests,
  deleteRequest,
  getDownloadStatus,
  triggerAlbumSearch,
} from "../utils/api";
import ArtistImage from "../components/ArtistImage";
import { useToast } from "../contexts/ToastContext";
import { useWebSocketChannel } from "../hooks/useWebSocket";

function RequestsPage() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [downloadStatuses, setDownloadStatuses] = useState({});
  const [reSearchingAlbumIds, setReSearchingAlbumIds] = useState({});
  const navigate = useNavigate();
  const { showError, showSuccess } = useToast();
  const activeAlbumIdsRef = useRef([]);
  const lastDownloadWsAtRef = useRef(0);
  const handleDownloadStatusMessage = useCallback((msg) => {
    if (msg?.type !== "download_statuses") return;
    lastDownloadWsAtRef.current = Date.now();
    const activeIds = activeAlbumIdsRef.current;
    if (!activeIds.length) return;
    const incoming = msg.statuses || {};
    const next = {};
    for (const id of activeIds) {
      if (incoming[id]) next[id] = incoming[id];
    }
    setDownloadStatuses((prev) => {
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (prevKeys.length !== nextKeys.length) return next;
      for (const key of nextKeys) {
        const prevStatus = prev[key];
        const nextStatus = next[key];
        if (
          prevStatus?.status !== nextStatus?.status ||
          prevStatus?.progress !== nextStatus?.progress ||
          prevStatus?.updatedAt !== nextStatus?.updatedAt
        ) {
          return next;
        }
      }
      return prev;
    });
  }, []);

  useWebSocketChannel("downloads", handleDownloadStatusMessage);

  const activeAlbumIds = useMemo(() => {
    return requests
      .filter(
        (request) =>
          request.albumId &&
          (request.inQueue ||
            (request.status &&
              request.status !== "available" &&
              request.status !== "failed")),
      )
      .map((request) => String(request.albumId));
  }, [requests]);

  const activeAlbumIdsKey = useMemo(() => {
    if (!activeAlbumIds.length) return "";
    return [...activeAlbumIds].sort().join(",");
  }, [activeAlbumIds]);

  const fetchRequests = useCallback(async ({ silent = false } = {}) => {
    if (!silent) {
      setLoading(true);
    }

    try {
      const data = await getRequests();
      setRequests(data);
      setError(null);
    } catch {
      setError("Failed to load requests history.");
    } finally {
      if (!silent) {
        setLoading(false);
      }
    }
  }, []);

  const fetchActiveDownloadStatus = useCallback(async (albumIds) => {
    const hasExplicitAlbumIds = Array.isArray(albumIds);
    const ids = Array.isArray(albumIds)
      ? albumIds
      : activeAlbumIdsRef.current;
    if (!ids.length) {
      setDownloadStatuses({});
      return;
    }
    try {
      const statuses = await getDownloadStatus(ids);
      setDownloadStatuses((prev) => {
        if (hasExplicitAlbumIds) {
          return {
            ...prev,
            ...(statuses || {}),
          };
        }
        return statuses || {};
      });
    } catch {}
  }, []);

  useEffect(() => {
    activeAlbumIdsRef.current = activeAlbumIds;
  }, [activeAlbumIds]);

  useEffect(() => {
    fetchRequests();
    const initialRefreshTimeout = setTimeout(() => {
      fetchRequests({ silent: true });
    }, 2500);

    const handleFocus = () => {
      fetchRequests({ silent: true });
      fetchActiveDownloadStatus();
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible") {
        fetchRequests({ silent: true });
        fetchActiveDownloadStatus();
      }
    };

    window.addEventListener("focus", handleFocus);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      clearTimeout(initialRefreshTimeout);
      window.removeEventListener("focus", handleFocus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [fetchRequests, fetchActiveDownloadStatus]);

  useEffect(() => {
    const albumIds = activeAlbumIdsKey ? activeAlbumIdsKey.split(",") : [];
    if (!albumIds.length) {
      setDownloadStatuses({});
      return;
    }

    let cancelled = false;
    const pollDownloadStatus = async () => {
      if (Date.now() - lastDownloadWsAtRef.current < 20000) {
        return;
      }
      try {
        const statuses = await getDownloadStatus(albumIds);
        if (!cancelled) {
          setDownloadStatuses(statuses || {});
        }
      } catch {}
    };

    pollDownloadStatus();
    const interval = setInterval(pollDownloadStatus, 15000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activeAlbumIdsKey]);

  useEffect(() => {
    const hasActive = requests.some(
      (request) =>
        request.inQueue ||
        (request.status && request.status !== "available" && request.status !== "failed"),
    );
    const intervalMs = hasActive ? 15000 : 60000;
    const interval = setInterval(() => {
      fetchRequests({ silent: true });
    }, intervalMs);
    return () => clearInterval(interval);
  }, [requests, fetchRequests]);

  const handleStopDownload = async (request) => {
    if (!request.inQueue || !request.albumId) return;
    try {
      await deleteRequest(request.albumId);
      setRequests((prev) =>
        prev.filter((r) => String(r.albumId) !== String(request.albumId))
      );
    } catch {
      showError("Failed to stop download");
    }
  };

  const handleReSearchRequest = async (request) => {
    if (!request?.albumId) return;
    const albumId = String(request.albumId);
    setReSearchingAlbumIds((prev) => ({
      ...prev,
      [albumId]: true,
    }));
    try {
      setDownloadStatuses((prev) => ({
        ...prev,
        [albumId]: { status: "searching" },
      }));
      await triggerAlbumSearch(request.albumId);
      showSuccess("Search triggered for album");
      fetchActiveDownloadStatus([albumId]);
    } catch (err) {
      showError(
        `Failed to re-search album: ${
          err.response?.data?.message || err.message
        }`,
      );
    } finally {
      setReSearchingAlbumIds((prev) => {
        const next = { ...prev };
        delete next[albumId];
        return next;
      });
    }
  };

  const getStatusBadge = (request) => {
    const albumStatus = request.albumId
      ? downloadStatuses[String(request.albumId)]
      : null;
    const artistDownloadStatuses = Object.values(downloadStatuses).filter(
      (status) => {
        return (
          status &&
          (status.status === "adding" ||
            status.status === "searching" ||
            status.status === "downloading" ||
            status.status === "moving")
        );
      }
    );

    const hasActiveDownloads = artistDownloadStatuses.length > 0;

    if (albumStatus?.status === "adding") {
      return (
        <span
          className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold uppercase rounded"
          style={{ backgroundColor: "#211f27", color: "#c1c1c3" }}
        >
          <Loader className="w-3 h-3 animate-spin" />
          Adding...
        </span>
      );
    }

    if (albumStatus?.status === "downloading") {
      return (
        <span
          className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold uppercase rounded"
          style={{ backgroundColor: "#211f27", color: "#c1c1c3" }}
        >
          <Loader className="w-3 h-3 animate-spin" />
          Downloading...
        </span>
      );
    }

    if (albumStatus?.status === "searching") {
      return (
        <span
          className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold uppercase rounded"
          style={{ backgroundColor: "#211f27", color: "#c1c1c3" }}
        >
          <Loader className="w-3 h-3 animate-spin" />
          Searching...
        </span>
      );
    }

    if (albumStatus?.status === "moving") {
      return (
        <span
          className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold uppercase rounded"
          style={{ backgroundColor: "#211f27", color: "#c1c1c3" }}
        >
          <Loader className="w-3 h-3 animate-spin" />
          Moving files...
        </span>
      );
    }

    if (albumStatus?.status === "processing") {
      return (
        <span
          className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold uppercase rounded"
          style={{ backgroundColor: "#211f27", color: "#c1c1c3" }}
        >
          <Loader className="w-3 h-3 animate-spin" />
          Processing
        </span>
      );
    }

    if (albumStatus?.status === "added") {
      return (
        <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold uppercase bg-green-500/20 text-green-400 rounded">
          <CheckCircle2 className="w-3 h-3" />
          Completed
        </span>
      );
    }

    if (request.status === "available") {
      return (
        <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold uppercase bg-green-500/20 text-green-400 rounded">
          <CheckCircle2 className="w-3 h-3" />
          Available
        </span>
      );
    }

    if (albumStatus?.status === "failed" || request.status === "failed") {
      return (
        <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold uppercase bg-red-500/20 text-red-400 rounded">
          <AlertCircle className="w-3 h-3" />
          Failed
        </span>
      );
    }

    if (request.status === "processing" || hasActiveDownloads) {
      return (
        <span
          className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold uppercase rounded"
          style={{ backgroundColor: "#211f27", color: "#c1c1c3" }}
        >
          <Loader className="w-3 h-3 animate-spin" />
          {hasActiveDownloads ? "Downloading..." : "Processing"}
        </span>
      );
    }

    return (
      <span className="flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-bold uppercase bg-yellow-500/20 text-yellow-400 rounded">
        Requested
      </span>
    );
  };

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-32">
        <Loader
          className="w-12 h-12 animate-spin mb-4"
          style={{ color: "#c1c1c3" }}
        />
        <h2 className="text-xl font-semibold" style={{ color: "#fff" }}>
          Loading your requests...
        </h2>
      </div>
    );
  }

  return (
    <div className="animate-fade-in pb-12">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
        <div className="flex items-center gap-4">
          <div>
            <h1
              className="text-2xl font-bold flex items-center"
              style={{ color: "#fff" }}
            >
              Requests
            </h1>
            <p className="text-sm" style={{ color: "#c1c1c3" }}>
              Track your album requests and their availability
            </p>
          </div>
        </div>
      </div>

      {error && (
        <div className="bg-red-500/20 ">
          <AlertCircle className="w-5 h-5 text-red-400" />
          <p className="text-red-400">{error}</p>
        </div>
      )}

      {requests.length === 0 ? (
        <div className="card text-center py-20">
          <Music
            className="w-16 h-16 mx-auto mb-4"
            style={{ color: "#c1c1c3" }}
          />
          <h3 className="text-xl font-semibold mb-2" style={{ color: "#fff" }}>
            No Requests Found
          </h3>
          <p className="mb-6" style={{ color: "#c1c1c3" }}>
            You haven&apos;t requested any albums yet.
          </p>
          <button onClick={() => navigate("/")} className="btn btn-primary">
            Start Discovering
          </button>
        </div>
      ) : (
        <div className="grid gap-2">
          {requests.map((request) => {
            const isAlbum = request.type === "album";
            const displayName = isAlbum ? request.albumName : request.name;
            const artistName = isAlbum ? request.artistName : null;
            const artistMbid = isAlbum ? request.artistMbid : request.mbid;
            const hasValidMbid =
              artistMbid && artistMbid !== "null" && artistMbid !== "undefined";
            const albumStatus = request.albumId
              ? downloadStatuses[String(request.albumId)]
              : null;
            const statusValue = albumStatus?.status;
            const isFailed =
              statusValue === "failed" ||
              (!statusValue && request.status === "failed");
            const isReSearching =
              request.albumId &&
              !!reSearchingAlbumIds[String(request.albumId)];

            return (
              <div
                key={request.id || request.mbid}
                className="card group relative overflow-hidden p-3 pr-12 transition-all hover:shadow-md"
              >
                <div className="absolute right-1.5 top-1.5 z-10 flex items-center gap-1">
                  {isFailed && request.albumId && (
                    <button
                      type="button"
                      onClick={() => handleReSearchRequest(request)}
                      className="rounded p-1.5 transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-60"
                      style={{ color: "#fff" }}
                      title="Re-search"
                      aria-label="Re-search"
                      disabled={isReSearching}
                    >
                      {isReSearching ? (
                        <Loader className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="h-3.5 w-3.5" />
                      )}
                    </button>
                  )}
                  {request.inQueue && request.albumId && (
                    <button
                      type="button"
                      onClick={() => handleStopDownload(request)}
                      className="rounded p-1.5 transition-all hover:bg-red-500/20 hover:text-red-400"
                      style={{ color: "#fff" }}
                      title="Stop download"
                      aria-label="Stop download"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>

                <div className="grid min-w-0 grid-cols-[84px,minmax(0,1fr)] gap-3 sm:flex sm:flex-row sm:items-center">
                  <div
                    className={`h-full min-h-[112px] w-[84px] flex-shrink-0 overflow-hidden rounded-lg sm:h-16 sm:min-h-0 sm:w-16 ${
                      hasValidMbid
                        ? "cursor-pointer"
                        : "cursor-not-allowed opacity-50"
                    }`}
                    style={{ backgroundColor: "#211f27" }}
                    onClick={() => {
                      if (hasValidMbid) {
                        navigate(
                          isAlbum
                            ? `/artist/${artistMbid}`
                            : `/artist/${request.mbid}`,
                          {
                            state: {
                              artistName: isAlbum ? artistName : displayName,
                            },
                          }
                        );
                      }
                    }}
                  >
                    <ArtistImage
                      src={request.image}
                      mbid={artistMbid}
                      artistName={isAlbum ? artistName : displayName}
                      alt={displayName}
                      className="h-full w-full object-cover transition-transform group-hover:scale-105"
                    />
                  </div>

                  <div className="flex min-w-0 w-full flex-col justify-between text-left sm:flex-1">
                    <div className="min-w-0">
                      <h3
                        className={`w-full max-w-full text-base font-semibold leading-tight sm:truncate ${
                          hasValidMbid
                            ? "hover:underline cursor-pointer"
                            : "cursor-not-allowed opacity-75"
                        }`}
                        style={{ color: "#fff" }}
                        onClick={() => {
                          if (hasValidMbid) {
                            navigate(
                              isAlbum
                                ? `/artist/${artistMbid}`
                                : `/artist/${request.mbid}`,
                              {
                                state: {
                                  artistName: isAlbum
                                    ? artistName
                                    : displayName,
                                },
                              }
                            );
                          }
                        }}
                      >
                        {displayName}
                      </h3>

                      <div
                        className="mt-2 flex flex-col gap-1.5 text-xs sm:flex-wrap sm:flex-row sm:items-center sm:gap-3"
                        style={{ color: "#c1c1c3" }}
                      >
                        {isAlbum && artistName && (
                          <span className="flex max-w-full items-center gap-1 truncate">
                            <Music className="h-3 w-3 shrink-0" />
                            <span className="truncate">{artistName}</span>
                          </span>
                        )}
                        <span className="flex max-w-full items-center gap-1 truncate">
                          <Clock className="h-3 w-3 shrink-0" />
                          {new Date(request.requestedAt).toLocaleDateString(
                            undefined,
                            {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            }
                          )}
                        </span>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center gap-2 sm:mt-0 sm:ml-auto sm:flex-shrink-0">
                      {getStatusBadge(request)}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

    </div>
  );
}

export default RequestsPage;
