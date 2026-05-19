import { useCallback, useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import {
  Loader,
  Music,
  CheckCircle,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  MoreVertical,
  ExternalLink,
  Trash2,
  RefreshCw,
  Plus,
} from "lucide-react";
import { getPopularityScale } from "../utils";

export function ArtistDetailsLibraryAlbums({
  artist,
  libraryAlbums,
  downloadStatuses,
  requestingAlbum,
  reSearchingAlbum,
  reSearchingMissingAlbums,
  albumCovers,
  expandedLibraryAlbum,
  albumTracks,
  loadingTracks,
  albumDropdownOpen,
  setAlbumDropdownOpen,
  handleLibraryAlbumClick,
  canDeleteAlbum,
  handleDeleteAlbumClick,
  canReSearchAlbum,
  handleReSearchAlbum,
  handleReSearchMissingDownloads,
  onAddTrackToPlaylist,
  onVisibleCoverIdsChange,
}) {
  const railRef = useRef(null);
  const visibleCoverIdsRef = useRef(new Set());
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [completionFilter, setCompletionFilter] = useState("all");
  const downloadedAlbums = libraryAlbums.filter((album) => {
    if (String(album.id ?? "").startsWith("pending-")) return false;
    return (
      album.monitored ||
      album.statistics?.percentOfTracks > 0 ||
      album.statistics?.sizeOnDisk > 0 ||
      downloadStatuses[album.id] ||
      (requestingAlbum &&
        (album.mbid === requestingAlbum ||
          album.foreignAlbumId === requestingAlbum))
    );
  });

  const releaseGroups = artist?.["release-groups"] || [];
  getPopularityScale(releaseGroups);
  const popularityById = new Map(
    releaseGroups.map((rg) => [rg.id, typeof rg?.fans === "number" ? rg.fans : 0])
  );
  const getAlbumFans = (album) => {
    const rgId = album.mbid || album.foreignAlbumId;
    return popularityById.get(rgId) || 0;
  };
  const sortedAlbums = [...downloadedAlbums].sort((a, b) => {
    const diff = getAlbumFans(b) - getAlbumFans(a);
    if (diff !== 0) return diff;
    const dateA = a.releaseDate || "";
    const dateB = b.releaseDate || "";
    return dateB.localeCompare(dateA);
  });
  const getAlbumState = (libraryAlbum) => {
    const downloadStatus = downloadStatuses[libraryAlbum.id];
    const isComplete =
      (libraryAlbum.statistics?.percentOfTracks ?? 0) >= 100 ||
      (libraryAlbum.statistics?.sizeOnDisk ?? 0) > 0;
    const isActiveSearch =
      downloadStatus &&
      ["adding", "searching", "downloading", "moving", "processing"].includes(
        downloadStatus.status
      );
    const canReSearch =
      !isComplete &&
      !String(libraryAlbum.id ?? "").startsWith("pending-") &&
      !isActiveSearch &&
      (downloadStatus?.status === "failed" || libraryAlbum.monitored);
    return { downloadStatus, isComplete, canReSearch };
  };
  const visibleAlbums = sortedAlbums.filter((album) => {
    const { isComplete } = getAlbumState(album);
    if (completionFilter === "complete") return isComplete;
    if (completionFilter === "incomplete") return !isComplete;
    return true;
  });
  const visibleCoverSourceKey = visibleAlbums
    .map((album) => album.mbid || album.foreignAlbumId || album.id)
    .filter(Boolean)
    .join(",");
  const incompleteAlbumCount = sortedAlbums.filter(
    (album) => !getAlbumState(album).isComplete
  ).length;
  const filterTitle =
    completionFilter === "all"
      ? "Showing all library albums"
      : completionFilter === "incomplete"
        ? "Showing incomplete downloads"
        : "Showing completed downloads";

  const filterOptions = [
    {
      value: "all",
      label: "Show all library albums",
      title: "Show all library albums",
      renderIcon: () => (
        <span className="flex items-center gap-1.5">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: "#22c55e" }}
          />
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: "#eab308" }}
          />
        </span>
      ),
    },
    {
      value: "incomplete",
      label: "Show incomplete downloads",
      title: "Show incomplete downloads",
      renderIcon: () => (
        <span className="flex items-center gap-1">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: "#eab308" }}
          />
          <span
            className="h-2 w-2 rounded-full border border-white/10"
            style={{ backgroundColor: "rgba(255,255,255,0.08)" }}
          />
        </span>
      ),
    },
    {
      value: "complete",
      label: "Show completed downloads",
      title: "Show completed downloads",
      renderIcon: () => (
        <span className="flex items-center gap-1">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: "#22c55e" }}
          />
          <span
            className="h-2 w-2 rounded-full border border-white/10"
            style={{ backgroundColor: "rgba(255,255,255,0.08)" }}
          />
        </span>
      ),
    },
  ];

  const updateScrollState = useCallback(() => {
    const node = railRef.current;
    if (!node) return;
    const maxScrollLeft = Math.max(node.scrollWidth - node.clientWidth, 0);
    setCanScrollLeft(node.scrollLeft > 2);
    setCanScrollRight(node.scrollLeft < maxScrollLeft - 2);
  }, []);

  const scrollByAmount = useCallback((direction) => {
    const node = railRef.current;
    if (!node) return;
    const width = node.clientWidth;
    node.scrollBy({
      left: direction * Math.max(width * 0.85, 280),
      behavior: "smooth",
    });
  }, []);

  useEffect(() => {
    const node = railRef.current;
    if (!node) return;
    updateScrollState();
    node.addEventListener("scroll", updateScrollState, { passive: true });
    window.addEventListener("resize", updateScrollState);
    return () => {
      node.removeEventListener("scroll", updateScrollState);
      window.removeEventListener("resize", updateScrollState);
    };
  }, [visibleAlbums, updateScrollState]);

  useEffect(() => {
    if (!onVisibleCoverIdsChange || !visibleCoverSourceKey) return undefined;

    visibleCoverIdsRef.current = new Set();
    const node = railRef.current;
    if (!node) return undefined;

    const observer = new IntersectionObserver(
      (entries) => {
        let changed = false;
        for (const entry of entries) {
          const id = entry.target.getAttribute("data-cover-id");
          if (!id) continue;
          if (entry.isIntersecting) {
            if (!visibleCoverIdsRef.current.has(id)) {
              visibleCoverIdsRef.current.add(id);
              changed = true;
            }
          } else if (visibleCoverIdsRef.current.delete(id)) {
            changed = true;
          }
        }
        if (changed) {
          onVisibleCoverIdsChange(Array.from(visibleCoverIdsRef.current));
        }
      },
      {
        root: node,
        threshold: 0.6,
      },
    );

    node.querySelectorAll("[data-cover-id]").forEach((target) => {
      observer.observe(target);
    });

    return () => {
      observer.disconnect();
      visibleCoverIdsRef.current = new Set();
    };
  }, [onVisibleCoverIdsChange, visibleCoverSourceKey]);

  useEffect(() => {
    if (!onVisibleCoverIdsChange) return undefined;
    if (visibleCoverSourceKey) return undefined;
    onVisibleCoverIdsChange([]);
  }, [onVisibleCoverIdsChange, visibleCoverSourceKey]);

  if (downloadedAlbums.length === 0) return null;

  return (
    <div className="mb-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold" style={{ color: "#fff" }}>
          In your library
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          <div
            className="flex items-center rounded-full border border-white/10 p-1"
            style={{ backgroundColor: "rgba(255,255,255,0.03)" }}
            role="group"
            aria-label="Library download completion filter"
            title={filterTitle}
          >
            {filterOptions.map((option) => {
              const isActive = completionFilter === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setCompletionFilter(option.value)}
                  className="flex h-7 min-w-7 items-center justify-center rounded-full px-2 transition-colors hover:bg-white/5"
                  style={{
                    backgroundColor: isActive
                      ? "rgba(255,255,255,0.08)"
                      : "transparent",
                    boxShadow: isActive
                      ? "inset 0 0 0 1px rgba(255,255,255,0.06)"
                      : "none",
                  }}
                  aria-pressed={isActive}
                  aria-label={option.label}
                  title={option.title}
                >
                  {option.renderIcon()}
                </button>
              );
            })}
          </div>
          {canReSearchAlbum && (
            <button
              type="button"
              onClick={handleReSearchMissingDownloads}
              className="flex h-9 w-9 items-center justify-center rounded-full border border-white/10 transition-colors hover:bg-white/5 disabled:cursor-default disabled:opacity-50"
              style={{ color: "#d1d5df" }}
              aria-label="Re-search all missing downloads"
              title={
                incompleteAlbumCount > 0
                  ? `Re-search ${incompleteAlbumCount} missing download${
                      incompleteAlbumCount === 1 ? "" : "s"
                    }`
                  : "No missing downloads to re-search"
              }
              disabled={reSearchingMissingAlbums || incompleteAlbumCount === 0}
            >
              {reSearchingMissingAlbums ? (
                <Loader className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
            </button>
          )}
          <button
            type="button"
            onClick={() => scrollByAmount(-1)}
            className="flex h-10 w-10 items-center justify-center transition-colors disabled:cursor-default"
            style={{ color: canScrollLeft ? "#6f7685" : "#2d3442" }}
            aria-label="Scroll library albums left"
            disabled={!canScrollLeft}
          >
            <ChevronLeft className="h-7 w-7 stroke-[1.5]" />
          </button>
          <button
            type="button"
            onClick={() => scrollByAmount(1)}
            className="flex h-10 w-10 items-center justify-center transition-colors disabled:cursor-default"
            style={{ color: canScrollRight ? "#d1d5df" : "#2d3442" }}
            aria-label="Scroll library albums right"
            disabled={!canScrollRight}
          >
            <ChevronRight className="h-7 w-7 stroke-[1.5]" />
          </button>
        </div>
      </div>

      <div
        ref={railRef}
        className="flex gap-4 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {visibleAlbums.map((libraryAlbum) => {
          const rgId = libraryAlbum.mbid || libraryAlbum.foreignAlbumId;
          const isExpanded = expandedLibraryAlbum === rgId;
          const { downloadStatus, isComplete, canReSearch } =
            getAlbumState(libraryAlbum);
          const coverUrl = albumCovers[rgId];
          const hasDownloadedStatus =
            isComplete ||
            downloadStatus?.status === "added" ||
            downloadStatus?.status === "available";
          const showIncompleteStatus =
            !hasDownloadedStatus &&
            (canReSearch ||
              downloadStatus?.status === "failed" ||
              libraryAlbum.statistics?.percentOfTracks > 0);
          const statusDotColor = hasDownloadedStatus
            ? "#22c55e"
            : showIncompleteStatus
              ? "#eab308"
              : null;

          return (
            <article
              key={libraryAlbum.id}
              className="group flex w-[170px] min-w-[170px] flex-shrink-0 flex-col items-center"
              data-cover-id={rgId}
            >
              <div
                onClick={() => handleLibraryAlbumClick(rgId, libraryAlbum.id)}
                className="relative aspect-square w-full cursor-pointer overflow-hidden rounded-full border border-white/10 shadow-sm transition-all duration-300 group-hover:shadow-md"
                style={{
                  backgroundColor: "#211f27",
                  boxShadow: isExpanded
                    ? "0 0 0 1px rgba(255,255,255,0.08), 0 18px 40px rgba(0,0,0,0.28)"
                    : undefined,
                }}
              >
                {coverUrl ? (
                  <img
                    src={coverUrl}
                    alt={libraryAlbum.albumName}
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                    loading="lazy"
                    decoding="async"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <Music className="h-12 w-12" style={{ color: "#c1c1c3" }} />
                  </div>
                )}

                <div
                  className="absolute inset-0"
                  style={{
                    background:
                      "linear-gradient(180deg, rgba(11,12,14,0.18) 0%, rgba(11,12,14,0.02) 28%, rgba(11,12,14,0.72) 100%)",
                  }}
                />

                <div className="absolute left-3 right-3 top-3 flex items-start justify-between gap-2">
                  <span className="flex h-8 w-8 items-center justify-center">
                    {requestingAlbum === rgId || reSearchingAlbum === libraryAlbum.id ? (
                      <Loader className="h-3.5 w-3.5 animate-spin" style={{ color: "#fff" }} />
                    ) : statusDotColor ? (
                      <span
                        className="h-2.5 w-2.5 rounded-full shadow-[0_0_10px_rgba(0,0,0,0.25)]"
                        style={{ backgroundColor: statusDotColor }}
                        title={hasDownloadedStatus ? "Downloaded" : "Incomplete"}
                      />
                    ) : (
                      <span />
                    )}
                  </span>
                  <div className="relative overflow-visible">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setAlbumDropdownOpen(albumDropdownOpen === rgId ? null : rgId);
                      }}
                      className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 backdrop-blur-sm transition-colors hover:bg-white/10"
                      style={{ backgroundColor: "rgba(24,23,29,0.72)", color: "#fff" }}
                      title="Options"
                      aria-label={`Album options for ${libraryAlbum.albumName}`}
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>
                    {albumDropdownOpen === rgId && (
                      <>
                        <div
                          className="fixed inset-0 z-10"
                          onClick={(e) => {
                            e.stopPropagation();
                            setAlbumDropdownOpen(null);
                          }}
                        />
                        <div
                          className="absolute right-0 top-full z-20 mt-2 w-48 rounded-md border border-white/10 py-1 shadow-xl"
                          style={{
                            backgroundColor: "#2d2b35",
                            boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
                          }}
                        >
                          <a
                            href={`https://www.last.fm/music/${encodeURIComponent(
                              artist.name
                            )}/${encodeURIComponent(libraryAlbum.albumName)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="flex w-full items-center px-4 py-2 text-left text-sm transition-colors hover:bg-white/10"
                            style={{ color: "#fff" }}
                            onClick={() => setAlbumDropdownOpen(null)}
                          >
                            <ExternalLink className="mr-2 h-4 w-4" />
                            View on Last.fm
                          </a>
                          {canReSearch && canReSearchAlbum && (
                            <>
                              <div className="my-1 border-t border-white/10" />
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleReSearchAlbum(libraryAlbum.id, libraryAlbum.albumName);
                                  setAlbumDropdownOpen(null);
                                }}
                                className="flex w-full items-center px-4 py-2 text-left text-sm transition-colors hover:bg-white/10"
                                style={{ color: "#fff" }}
                                disabled={reSearchingAlbum === libraryAlbum.id}
                              >
                                {reSearchingAlbum === libraryAlbum.id ? (
                                  <Loader className="mr-2 h-4 w-4 animate-spin" />
                                ) : (
                                  <RefreshCw className="mr-2 h-4 w-4" />
                                )}
                                {reSearchingAlbum === libraryAlbum.id ? "Searching..." : "Re-search"}
                              </button>
                            </>
                          )}
                          {canDeleteAlbum && (
                            <>
                              <div className="my-1 border-t border-white/10" />
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleDeleteAlbumClick(rgId, libraryAlbum.albumName);
                                }}
                                className="flex w-full items-center px-4 py-2 text-left text-sm text-red-400 transition-colors hover:bg-red-500/20"
                              >
                                <Trash2 className="mr-2 h-4 w-4" />
                                Delete Album
                              </button>
                            </>
                          )}
                        </div>
                      </>
                    )}
                  </div>
                </div>

                <div className="absolute inset-x-0 bottom-0 p-4">
                  <div className="min-w-0">
                    <h3
                      className="line-clamp-2 text-center text-base font-semibold leading-tight"
                      style={{ color: "#fff" }}
                    >
                      {libraryAlbum.albumName}
                    </h3>
                  </div>
                </div>
              </div>

              <button
                type="button"
                onClick={() => handleLibraryAlbumClick(rgId, libraryAlbum.id)}
                className="mt-3 flex items-center justify-center gap-2 text-center transition-colors hover:text-white"
                style={{ color: isExpanded ? "#fff" : "#c1c1c3" }}
              >
                {isExpanded ? (
                  <ChevronUp className="h-4 w-4 flex-shrink-0" />
                ) : (
                  <ChevronDown className="h-4 w-4 flex-shrink-0" />
                )}
              </button>
            </article>
          );
        })}
      </div>

      {visibleAlbums.length === 0 && (
        <div
          className="rounded-2xl border border-dashed border-white/10 px-4 py-5 text-sm"
          style={{ color: "#9aa3b2", backgroundColor: "#1c1a22" }}
        >
          {completionFilter === "incomplete"
            ? "No incomplete downloads in your library."
            : completionFilter === "complete"
              ? "No completed downloads in your library."
              : "No library albums match this filter."}
        </div>
      )}

      {visibleAlbums.map((libraryAlbum, libraryAlbumIdx) => {
        const rgId = libraryAlbum.mbid || libraryAlbum.foreignAlbumId;
        if (expandedLibraryAlbum !== rgId) return null;
        const trackKey = libraryAlbum.id;
        const tracks = albumTracks[trackKey] || null;
        const isLoadingTracks = loadingTracks[trackKey] || false;

        return (
          <div
            key={`expanded-${libraryAlbum.id}`}
            className="mt-4 overflow-hidden rounded-2xl border border-white/10"
            style={{
              backgroundColor: libraryAlbumIdx % 2 === 0 ? "#1c1a22" : "#211f27",
            }}
          >
            <div className="px-4 py-4">
              <div className="mb-3 border-b border-white/10 pb-3">
                <div className="grid grid-cols-2 gap-2 text-xs sm:grid-cols-3">
                  {libraryAlbum.statistics && (
                    <>
                      <div>
                        <span style={{ color: "#c1c1c3" }}>Tracks:</span>
                        <span className="ml-2 font-medium" style={{ color: "#fff" }}>
                          {libraryAlbum.statistics.trackCount || 0}
                        </span>
                      </div>
                      <div>
                        <span style={{ color: "#c1c1c3" }}>Size:</span>
                        <span className="ml-2 font-medium" style={{ color: "#fff" }}>
                          {libraryAlbum.statistics.sizeOnDisk
                            ? `${(libraryAlbum.statistics.sizeOnDisk / 1024 / 1024).toFixed(2)} MB`
                            : "N/A"}
                        </span>
                      </div>
                      <div>
                        <span style={{ color: "#c1c1c3" }}>Completion:</span>
                        <span className="ml-2 font-medium" style={{ color: "#fff" }}>
                          {libraryAlbum.statistics.percentOfTracks || 0}%
                        </span>
                      </div>
                    </>
                  )}
                </div>
              </div>

              {isLoadingTracks ? (
                <div className="flex items-center justify-center py-4">
                  <Loader className="h-5 w-5 animate-spin" style={{ color: "#c1c1c3" }} />
                </div>
              ) : tracks && tracks.length > 0 ? (
                <div className="space-y-1">
                  {tracks.map((track, idx) => (
                    <div
                      key={track.id || track.title || idx}
                      className="group flex items-center gap-3 rounded-lg px-2 py-2 transition-colors hover:bg-white/5"
                    >
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <span
                          className="w-6 flex-shrink-0 text-xs"
                          style={{ color: "#c1c1c3" }}
                        >
                          {track.trackNumber || track.position || idx + 1}
                        </span>
                        <span className="truncate text-sm" style={{ color: "#fff" }}>
                          {track.title || track.trackName || "Unknown Track"}
                        </span>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-2">
                        {track.length && (
                          <span className="text-xs" style={{ color: "#c1c1c3" }}>
                            {Math.floor(track.length / 60000)}:
                            {Math.floor((track.length % 60000) / 1000)
                              .toString()
                              .padStart(2, "0")}
                          </span>
                        )}
                        {onAddTrackToPlaylist ? (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              onAddTrackToPlaylist(track, libraryAlbum, rgId);
                            }}
                            className="group inline-flex h-7 w-7 items-center overflow-hidden rounded-full transition-all duration-200 ease-out hover:w-[118px]"
                            style={{
                              backgroundColor: "rgba(255,255,255,0.06)",
                              color: "#fff",
                            }}
                            title="Add to playlist"
                            aria-label="Add to playlist"
                          >
                            <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center">
                              <Plus className="w-3.5 h-3.5" />
                            </span>
                            <span className="pr-3 text-xs font-medium whitespace-nowrap opacity-0 transition-all duration-150 ease-out -translate-x-2 group-hover:translate-x-0 group-hover:opacity-100">
                              Add to playlist
                            </span>
                          </button>
                        ) : null}
                        {track.hasFile ||
                        libraryAlbum?.statistics?.percentOfTracks >= 100 ||
                        libraryAlbum?.statistics?.sizeOnDisk > 0 ? (
                          <span
                            className="flex w-12 items-center justify-end"
                            style={{ color: "#c1c1c3" }}
                          >
                            <CheckCircle className="w-4 h-4 text-green-500" />
                          </span>
                        ) : (
                          <span className="w-12" />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="py-4 text-sm italic" style={{ color: "#c1c1c3" }}>
                  No tracks available
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

ArtistDetailsLibraryAlbums.propTypes = {
  artist: PropTypes.object,
  libraryAlbums: PropTypes.arrayOf(PropTypes.object),
  downloadStatuses: PropTypes.object,
  requestingAlbum: PropTypes.string,
  reSearchingAlbum: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  reSearchingMissingAlbums: PropTypes.bool,
  albumCovers: PropTypes.object,
  expandedLibraryAlbum: PropTypes.string,
  albumTracks: PropTypes.object,
  loadingTracks: PropTypes.object,
  albumDropdownOpen: PropTypes.string,
  setAlbumDropdownOpen: PropTypes.func,
  handleLibraryAlbumClick: PropTypes.func,
  canDeleteAlbum: PropTypes.bool,
  handleDeleteAlbumClick: PropTypes.func,
  canReSearchAlbum: PropTypes.bool,
  handleReSearchAlbum: PropTypes.func,
  handleReSearchMissingDownloads: PropTypes.func,
  onAddTrackToPlaylist: PropTypes.func,
  onVisibleCoverIdsChange: PropTypes.func,
};
