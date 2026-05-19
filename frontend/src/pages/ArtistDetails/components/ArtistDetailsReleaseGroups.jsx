import { useEffect, useRef, useState } from "react";
import PropTypes from "prop-types";
import {
  ArrowDownWideNarrow,
  ArrowUpDown,
  ArrowUpWideNarrow,
  Star,
  Loader,
  Music,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  MoreVertical,
  Filter,
  ExternalLink,
  Trash2,
  Plus,
  Disc,
  Disc3,
  FileMusic,
  RefreshCw,
  Play,
  Pause,
} from "lucide-react";
import AddAlbumButton from "../../../components/AddAlbumButton";
import { matchesReleaseTypeFilter } from "../utils";

export function ArtistDetailsReleaseGroups({
  artist,
  selectedReleaseTypes,
  setSelectedReleaseTypes,
  primaryReleaseTypes,
  secondaryReleaseTypes,
  showFilterDropdown,
  setShowFilterDropdown,
  loadingReleases,
  albumCovers,
  expandedReleaseGroup,
  albumTracks,
  loadingTracks,
  getAlbumStatus,
  albumDropdownOpen,
  setAlbumDropdownOpen,
  handleReleaseGroupAlbumClick,
  canAddAlbum,
  handleRequestAlbum,
  canDeleteAlbum,
  handleDeleteAlbumClick,
  requestingAlbum,
  reSearchingAlbum,
  canReSearchAlbum,
  handleReSearchAlbum,
  previewVolume,
  isReleaseGroupDownloadedInLibrary,
  onAddTrackToPlaylist,
  onVisibleCoverIdsChange,
}) {
  const [sortMode, setSortMode] = useState("date");
  const [playingTrackId, setPlayingTrackId] = useState(null);
  const [loadingTrackId, setLoadingTrackId] = useState(null);
  const [showMobileFilterMenu, setShowMobileFilterMenu] = useState(false);
  const previewAudioRef = useRef(null);
  const listRef = useRef(null);
  const visibleCoverIdsRef = useRef(new Set());
  const releaseGroups = artist["release-groups"] || [];
  const sortTitle =
    sortMode === "date"
      ? "Sort: Default"
      : sortMode === "popularityDesc"
        ? "Sort: Most popular"
        : "Sort: Least popular";
  const SortIcon =
    sortMode === "date"
      ? ArrowUpDown
      : sortMode === "popularityDesc"
        ? ArrowDownWideNarrow
        : ArrowUpWideNarrow;

  const getIcon = (type) => {
    if (type === "Album") return <Disc className="w-4 h-4" />;
    if (type === "EP") return <Disc3 className="w-4 h-4" />;
    if (type === "Single") return <FileMusic className="w-4 h-4" />;
    return <Music className="w-4 h-4" />;
  };

  const renderFilterMenuContent = (closeMenu) => (
    <div className="space-y-4">
      <div>
        <h3
          className="mb-2 text-sm font-semibold"
          style={{ color: "#fff" }}
        >
          Primary Types
        </h3>
        <div className="flex flex-wrap gap-2">
          {primaryReleaseTypes.map((type) => {
            const isSelected = selectedReleaseTypes.includes(type);
            return (
              <button
                key={type}
                type="button"
                onClick={() => {
                  if (isSelected) {
                    setSelectedReleaseTypes(
                      selectedReleaseTypes.filter((t) => t !== type)
                    );
                  } else {
                    setSelectedReleaseTypes([...selectedReleaseTypes, type]);
                  }
                }}
                className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium transition-all"
                style={{
                  backgroundColor: isSelected ? "#4a4a4a" : "#18171d",
                  color: "#fff",
                }}
              >
                {getIcon(type)}
                <span>{type}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div>
        <h3
          className="mb-2 text-sm font-semibold"
          style={{ color: "#fff" }}
        >
          Secondary Types
        </h3>
        <div className="space-y-2">
          {secondaryReleaseTypes.map((type) => (
            <label
              key={type}
              className="flex cursor-pointer items-center space-x-2 px-2 py-1.5 transition-colors hover:bg-gray-900/50"
            >
              <input
                type="checkbox"
                checked={selectedReleaseTypes.includes(type)}
                onChange={(e) => {
                  if (e.target.checked) {
                    setSelectedReleaseTypes([...selectedReleaseTypes, type]);
                  } else {
                    setSelectedReleaseTypes(
                      selectedReleaseTypes.filter((t) => t !== type)
                    );
                  }
                }}
                className="form-checkbox h-4 w-4"
                style={{ color: "#c1c1c3" }}
              />
              <span className="text-sm" style={{ color: "#fff" }}>
                {type}
              </span>
            </label>
          ))}
        </div>
      </div>

      <div className="pt-3">
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              const currentPrimary = selectedReleaseTypes.filter((t) =>
                primaryReleaseTypes.includes(t)
              );
              setSelectedReleaseTypes([
                ...currentPrimary,
                ...secondaryReleaseTypes,
              ]);
            }}
            className="text-xs hover:underline"
            style={{ color: "#c1c1c3" }}
          >
            Select All
          </button>
          <span style={{ color: "#c1c1c3" }}>|</span>
          <button
            type="button"
            onClick={() => {
              const currentPrimary = selectedReleaseTypes.filter((t) =>
                primaryReleaseTypes.includes(t)
              );
              setSelectedReleaseTypes(currentPrimary);
            }}
            className="text-xs hover:underline"
            style={{ color: "#c1c1c3" }}
          >
            Clear All
          </button>
          <span style={{ color: "#c1c1c3" }}>|</span>
          <button
            type="button"
            onClick={closeMenu}
            className="text-xs hover:underline"
            style={{ color: "#c1c1c3" }}
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );

  useEffect(() => {
    const audio = previewAudioRef.current;
    if (!audio) return;
    audio.volume = previewVolume;
  }, [previewVolume]);

  useEffect(() => {
    const audio = previewAudioRef.current;
    if (!audio) return;
    const resetPlayback = () => {
      setPlayingTrackId(null);
      setLoadingTrackId(null);
    };
    audio.addEventListener("ended", resetPlayback);
    audio.addEventListener("error", resetPlayback);
    return () => {
      audio.removeEventListener("ended", resetPlayback);
      audio.removeEventListener("error", resetPlayback);
      audio.pause();
      audio.src = "";
    };
  }, []);

  const handleTrackPreviewPlay = async (track, e) => {
    e.stopPropagation();
    const previewUrl = track?.preview_url;
    const trackId = String(track?.id ?? track?.mbid ?? "");
    const audio = previewAudioRef.current;
    if (!audio || !previewUrl || !trackId) return;

    if (playingTrackId === trackId && !audio.paused) {
      audio.pause();
      setPlayingTrackId(null);
      setLoadingTrackId(null);
      return;
    }

    try {
      setLoadingTrackId(trackId);
      if (audio.src !== previewUrl) {
        audio.src = previewUrl;
      }
      await audio.play();
      setPlayingTrackId(trackId);
    } catch {
      setPlayingTrackId(null);
    } finally {
      setLoadingTrackId(null);
    }
  };

  const filtered = releaseGroups
    .filter((rg) => matchesReleaseTypeFilter(rg, selectedReleaseTypes))
    .filter((rg) => !isReleaseGroupDownloadedInLibrary(rg.id));
  const visibleCoverSourceKey = filtered.map((rg) => rg.id).join(",");
  const visibleCount = filtered.length;
  const getReleaseMetric = (releaseGroup) => {
    const ratingValue =
      releaseGroup?.rating?.value != null &&
      Number.isFinite(Number(releaseGroup.rating.value))
        ? Number(releaseGroup.rating.value)
        : null;
    if (ratingValue != null) {
      return { type: "rating", sortValue: ratingValue };
    }
    const fans = typeof releaseGroup?.fans === "number" ? releaseGroup.fans : 0;
    return { type: "fans", sortValue: fans };
  };
  const sortedReleaseGroups = [...filtered].sort((a, b) => {
    const metricA = getReleaseMetric(a).sortValue;
    const metricB = getReleaseMetric(b).sortValue;
    if (sortMode === "popularityAsc") {
      const diff = metricA - metricB;
      if (diff !== 0) return diff;
    } else if (sortMode === "popularityDesc") {
      const diff = metricB - metricA;
      if (diff !== 0) return diff;
    }
    const dateA = a["first-release-date"] || "";
    const dateB = b["first-release-date"] || "";
    return dateB.localeCompare(dateA);
  });

  useEffect(() => {
    if (!onVisibleCoverIdsChange || !visibleCoverSourceKey) return undefined;

    visibleCoverIdsRef.current = new Set();
    const root = listRef.current;
    if (!root) return undefined;

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
      { root: null, threshold: 0.15 },
    );

    root.querySelectorAll("[data-cover-id]").forEach((node) => {
      observer.observe(node);
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

  if (releaseGroups.length === 0) return null;

  return (
    <div className="card p-3 sm:p-4">
      <audio ref={previewAudioRef} preload="none" />
      <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <h2
              className="flex items-center text-lg font-semibold"
              style={{ color: "#fff" }}
            >
              Releases ({visibleCount})
            </h2>
            {loadingReleases ? (
              <Loader
                className="h-4 w-4 animate-spin"
                style={{ color: "#c1c1c3" }}
              />
            ) : null}
            <button
              type="button"
              onClick={() =>
                setSortMode((prev) =>
                  prev === "date"
                    ? "popularityDesc"
                    : prev === "popularityDesc"
                      ? "popularityAsc"
                      : "date",
                )
              }
              className="btn btn-secondary btn-sm p-2 sm:hidden"
              title={sortTitle}
              aria-label={sortTitle}
            >
              <SortIcon className="w-4 h-4" />
            </button>
          </div>
          <div className="relative sm:hidden">
            <button
              type="button"
              onClick={() => setShowMobileFilterMenu((value) => !value)}
              className="btn btn-outline-secondary btn-sm p-2"
              aria-label="Album filters"
              title="Album filters"
            >
              <MoreVertical className="w-4 h-4" />
            </button>

            {showMobileFilterMenu && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowMobileFilterMenu(false)}
                />
                <div
                  className="absolute right-0 top-full mt-2 z-20 min-w-[260px] rounded-md border border-white/10 p-4 shadow-xl"
                  style={{ backgroundColor: "#211f27" }}
                >
                  {renderFilterMenuContent(() => setShowMobileFilterMenu(false))}
                </div>
              </>
            )}
          </div>
        </div>
        <div className="hidden shrink-0 items-center gap-2 sm:flex sm:pr-3">
          <button
            type="button"
            onClick={() =>
              setSortMode((prev) =>
                prev === "date"
                  ? "popularityDesc"
                  : prev === "popularityDesc"
                    ? "popularityAsc"
                    : "date",
              )
            }
            className="btn btn-secondary btn-sm p-2"
            title={sortTitle}
            aria-label={sortTitle}
          >
            <SortIcon className="w-4 h-4" />
          </button>
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowFilterDropdown(!showFilterDropdown)}
              className="btn btn-outline-secondary btn-sm p-2"
              aria-label="Album filters"
              title="Album filters"
            >
              <Filter className="w-4 h-4" />
            </button>

            {showFilterDropdown && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowFilterDropdown(false)}
                />
                <div
                  className="absolute right-0 top-full mt-2 z-20  shadow-xl  p-4 min-w-[280px]"
                  style={{ backgroundColor: "#211f27" }}
                >
                  {renderFilterMenuContent(() => setShowFilterDropdown(false))}
                </div>
              </>
            )}
          </div>
        </div>
      </div>
      <div ref={listRef} className="space-y-2">
        {sortedReleaseGroups.map((releaseGroup, releaseGroupIdx) => {
            const status = getAlbumStatus(releaseGroup.id);
            const isExpanded = expandedReleaseGroup === releaseGroup.id;
            const libraryAlbumId = status?.libraryId;
            const trackKey = libraryAlbumId || releaseGroup.id;
            const tracks = albumTracks[trackKey] || null;
            const isLoadingTracks = loadingTracks[trackKey] || false;
            const isActiveStatus =
              status &&
              ["processing", "adding", "searching", "downloading", "moving"].includes(
                status.status,
              );
            const canReSearch =
              status &&
              status.libraryId &&
              !String(status.libraryId).startsWith("pending-") &&
              !isActiveStatus &&
              status.status !== "available" &&
              status.status !== "added";
            const rowBg = isExpanded
              ? "#2a2830"
              : releaseGroupIdx % 2 === 0
              ? "#211f27"
              : "#1c1a22";
            const rowHoverBg = isExpanded ? "#2a2830" : "#25232b";
            const itemBg =
              releaseGroupIdx % 2 === 0 ? "#1c1a22" : "#211f27";

            const AlbumDropdown = () => (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={(e) => {
                    e.stopPropagation();
                    setAlbumDropdownOpen(null);
                  }}
                />
                <div
                  className="absolute right-0 top-full mt-2 w-48 shadow-xl z-20 py-1 rounded-md border border-white/10"
                  style={{
                    backgroundColor: "#2d2b35",
                    boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
                  }}
                >
                  <a
                    href={`https://www.last.fm/music/${encodeURIComponent(
                      artist.name
                    )}/${encodeURIComponent(releaseGroup.title)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full text-left px-4 py-2 text-sm hover:bg-white/10 transition-colors flex items-center"
                    style={{ color: "#fff" }}
                    onClick={() => setAlbumDropdownOpen(null)}
                  >
                    <ExternalLink className="w-4 h-4 mr-2" />
                    View on Last.fm
                  </a>
                  {canReSearch && canReSearchAlbum && (
                    <>
                      <div className="my-1 border-t border-white/10" />
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleReSearchAlbum(
                            status.libraryId,
                            releaseGroup.title,
                          );
                          setAlbumDropdownOpen(null);
                        }}
                        className="w-full text-left px-4 py-2 text-sm hover:bg-white/10 transition-colors flex items-center"
                        style={{ color: "#fff" }}
                        disabled={reSearchingAlbum === status.libraryId}
                      >
                        {reSearchingAlbum === status.libraryId ? (
                          <Loader className="w-4 h-4 mr-2 animate-spin" />
                        ) : (
                          <RefreshCw className="w-4 h-4 mr-2" />
                        )}
                        {reSearchingAlbum === status.libraryId
                          ? "Searching..."
                          : "Re-search"}
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
                          handleDeleteAlbumClick(
                            releaseGroup.id,
                            releaseGroup.title
                          );
                        }}
                        className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-red-500/20 transition-colors flex items-center"
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Delete Album
                      </button>
                    </>
                  )}
                </div>
              </>
            );

            return (
              <div
                key={releaseGroup.id}
                className="overflow-hidden rounded-2xl transition-colors"
                style={{ backgroundColor: rowBg }}
                data-cover-id={releaseGroup.id}
                onMouseEnter={(e) => {
                  if (!isExpanded) {
                    e.currentTarget.style.backgroundColor = rowHoverBg;
                  }
                }}
                onMouseLeave={(e) => {
                  if (!isExpanded) {
                    e.currentTarget.style.backgroundColor = rowBg;
                  }
                }}
              >
                <div
                  className="flex min-w-0 cursor-pointer items-start justify-between gap-3 px-3 py-3 sm:items-center"
                  onClick={() =>
                    handleReleaseGroupAlbumClick(
                      releaseGroup.id,
                      status?.libraryId
                    )
                  }
                >
                  <div className="flex min-w-0 flex-1 items-start gap-3 sm:items-center">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleReleaseGroupAlbumClick(
                          releaseGroup.id,
                          status?.libraryId
                        );
                      }}
                      className="hover:text-gray-300 transition-colors"
                      style={{ color: "#c1c1c3" }}
                    >
                      {isExpanded ? (
                        <ChevronUp className="w-4 h-4" />
                      ) : (
                        <ChevronDown className="w-4 h-4" />
                      )}
                    </button>
                    {albumCovers[releaseGroup.id] ? (
                      <img
                        src={albumCovers[releaseGroup.id]}
                        alt={releaseGroup.title}
                        className="h-14 w-14 flex-shrink-0 rounded-lg object-cover sm:h-10 sm:w-10"
                        loading="lazy"
                        decoding="async"
                      />
                    ) : (
                      <div
                        className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-lg sm:h-10 sm:w-10"
                        style={{ backgroundColor: itemBg }}
                      >
                        <Music
                          className="w-5 h-5"
                          style={{ color: "#c1c1c3" }}
                        />
                      </div>
                    )}
                    <div className="flex-1 min-w-0">
                      <h3
                        className="truncate text-base font-semibold sm:text-sm"
                        style={{ color: "#fff" }}
                      >
                        {releaseGroup.title}
                      </h3>
                      <div
                        className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
                        style={{ color: "#c1c1c3" }}
                      >
                        {releaseGroup["first-release-date"] && (
                          <span>
                            {
                              releaseGroup["first-release-date"].split(
                                "-"
                              )[0]
                            }
                          </span>
                        )}
                        {releaseGroup["primary-type"] && (
                          <span className="badge badge-primary text-xs">
                            {releaseGroup["primary-type"]}
                          </span>
                        )}
                        {releaseGroup["secondary-types"] &&
                          releaseGroup["secondary-types"].length > 0 && (
                            <span
                              className="badge text-xs"
                              style={{
                                backgroundColor: "#211f27",
                                color: "#fff",
                              }}
                            >
                              {releaseGroup["secondary-types"].join(", ")}
                            </span>
                          )}
                        {(() => {
                          const ratingValue =
                            releaseGroup?.rating?.value != null &&
                            Number.isFinite(Number(releaseGroup.rating.value))
                              ? Number(releaseGroup.rating.value)
                              : null;
                          const ratingCount =
                            releaseGroup?.rating?.count != null &&
                            Number.isFinite(Number(releaseGroup.rating.count))
                              ? Number(releaseGroup.rating.count)
                              : 0;
                          const fans =
                            typeof releaseGroup?.fans === "number"
                              ? releaseGroup.fans
                              : 0;
                          if (ratingValue == null && fans <= 0) return null;
                          return (
                            <span
                              className="ml-1 inline-flex items-center gap-1 rounded-full border border-white/10 bg-black/15 px-2 py-0.5"
                              title={
                                ratingValue != null
                                  ? `Rating: ${ratingValue.toFixed(1)}${ratingCount > 0 ? ` (${ratingCount} votes)` : ""}`
                                  : `Popularity fallback: ${fans.toLocaleString()} listeners`
                              }
                            >
                              <Star className="h-3.5 w-3.5" style={{ color: "#eab308" }} />
                              <span style={{ color: "#fff" }}>
                                {ratingValue != null
                                  ? ratingValue.toFixed(1)
                                  : `${fans.toLocaleString()}`}
                              </span>
                              {ratingValue != null && ratingCount > 0 ? (
                                <span style={{ color: "#c1c1c3" }}>
                                  ({ratingCount})
                                </span>
                              ) : null}
                            </span>
                          );
                        })()}
                      </div>
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-2 self-end sm:self-auto">
                    {status ? (
                      status.status === "available" ||
                      status.status === "added" ? (
                        <>
                          <span className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold uppercase bg-green-500/20 text-green-400 cursor-default">
                            <CheckCircle className="w-3.5 h-3.5" />
                            {status.label || "Available"}
                          </span>
                          <div className="relative overflow-visible">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setAlbumDropdownOpen(
                                  albumDropdownOpen === releaseGroup.id
                                    ? null
                                    : releaseGroup.id
                                );
                              }}
                              className="btn btn-secondary btn-sm p-2"
                              style={{
                                backgroundColor: itemBg,
                                borderColor: itemBg,
                                color: "#c1c1c3",
                              }}
                              title="Options"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>
                            {albumDropdownOpen === releaseGroup.id && (
                              <AlbumDropdown />
                            )}
                          </div>
                        </>
                      ) : status.status === "failed" ? (
                        <>
                          <span className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold uppercase bg-red-500/20 text-red-400 cursor-default">
                            Failed
                          </span>
                          <div className="relative overflow-visible">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setAlbumDropdownOpen(
                                  albumDropdownOpen === releaseGroup.id
                                    ? null
                                    : releaseGroup.id
                                );
                              }}
                              className="btn btn-secondary btn-sm p-2"
                              style={{
                                backgroundColor: itemBg,
                                borderColor: itemBg,
                                color: "#c1c1c3",
                              }}
                              title="Options"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>
                            {albumDropdownOpen === releaseGroup.id && (
                              <AlbumDropdown />
                            )}
                          </div>
                        </>
                      ) : status.status === "monitored" ? (
                        <>
                          <span
                            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold uppercase cursor-default"
                            style={{
                              backgroundColor: itemBg,
                              color: "#c1c1c3",
                            }}
                          >
                            {status.label || "Monitored"}
                          </span>
                          <div className="relative overflow-visible">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setAlbumDropdownOpen(
                                  albumDropdownOpen === releaseGroup.id
                                    ? null
                                    : releaseGroup.id
                                );
                              }}
                              className="btn btn-secondary btn-sm p-2"
                              style={{
                                backgroundColor: itemBg,
                                borderColor: itemBg,
                                color: "#c1c1c3",
                              }}
                              title="Options"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>
                            {albumDropdownOpen === releaseGroup.id && (
                              <AlbumDropdown />
                            )}
                          </div>
                        </>
                      ) : status.status === "processing" ||
                        status.status === "adding" ||
                        status.status === "searching" ||
                        status.status === "downloading" ||
                        status.status === "moving" ? (
                        <>
                          <span
                            className="flex items-center gap-1.5 px-2.5 py-1 text-xs font-bold uppercase cursor-default"
                            style={{
                              backgroundColor: itemBg,
                              color: "#c1c1c3",
                            }}
                          >
                            <Loader className="w-3.5 h-3.5 animate-spin" />
                            {status.label || "Processing"}
                          </span>
                          <div className="relative overflow-visible">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setAlbumDropdownOpen(
                                  albumDropdownOpen === releaseGroup.id
                                    ? null
                                    : releaseGroup.id
                                );
                              }}
                              className="btn btn-secondary btn-sm p-2"
                              style={{
                                backgroundColor: itemBg,
                                borderColor: itemBg,
                                color: "#c1c1c3",
                              }}
                              title="Options"
                            >
                              <MoreVertical className="w-4 h-4" />
                            </button>
                            {albumDropdownOpen === releaseGroup.id && (
                              <AlbumDropdown />
                            )}
                          </div>
                        </>
                      ) : (
                        canAddAlbum ? (
                          <AddAlbumButton
                            onClick={(e) => {
                              e.stopPropagation();
                              handleRequestAlbum(
                                releaseGroup.id,
                                releaseGroup.title
                              );
                            }}
                            isLoading={requestingAlbum === releaseGroup.id}
                            disabled={requestingAlbum === releaseGroup.id}
                            style={{
                              backgroundColor: itemBg,
                              borderColor: itemBg,
                            }}
                          />
                        ) : null
                      )
                    ) : (
                      canAddAlbum ? (
                        <AddAlbumButton
                          onClick={(e) => {
                            e.stopPropagation();
                            handleRequestAlbum(
                              releaseGroup.id,
                              releaseGroup.title
                            );
                          }}
                          isLoading={requestingAlbum === releaseGroup.id}
                          disabled={requestingAlbum === releaseGroup.id}
                          style={{
                            backgroundColor: itemBg,
                            borderColor: itemBg,
                          }}
                        />
                      ) : null
                    )}
                  </div>
                </div>

                {isExpanded && (
                  <div
                    className="px-3 py-2 overflow-hidden"
                    style={{
                      backgroundColor:
                        releaseGroupIdx % 2 === 0 ? "#1c1a22" : "#211f27",
                    }}
                  >
                    <div>
                      {isLoadingTracks ? (
                        <div className="flex items-center justify-center py-4">
                          <Loader
                            className="w-5 h-5 animate-spin"
                            style={{ color: "#c1c1c3" }}
                          />
                        </div>
                      ) : tracks && tracks.length > 0 ? (
                        <div className="space-y-0">
                          {tracks.map((track, idx) => {
                            const trackId = String(
                              track.id ?? track.mbid ?? `${trackKey}-${idx}`,
                            );
                            const hasPreview = Boolean(track.preview_url);
                            const isPlaying = playingTrackId === trackId;
                            const isLoadingPreview = loadingTrackId === trackId;
                            const durationLabel = track.length
                              ? `${Math.floor(track.length / 60000)}:${Math.floor(
                                  (track.length % 60000) / 1000
                                )
                                  .toString()
                                  .padStart(2, "0")}`
                              : "";

                            return (
                              <div
                                key={trackId}
                                className="flex items-center justify-between py-1.5 px-2 transition-colors text-sm"
                                style={{
                                  backgroundColor:
                                    idx % 2 === 0
                                      ? "transparent"
                                      : "rgba(255, 255, 255, 0.02)",
                                }}
                              >
                                <div className="flex items-center gap-3 flex-1 min-w-0">
                                  <span
                                    className="text-xs  w-6 flex-shrink-0"
                                    style={{ color: "#c1c1c3" }}
                                  >
                                    {track.trackNumber ||
                                      track.position ||
                                      idx + 1}
                                  </span>
                                  <span
                                    className="text-sm  truncate"
                                    style={{ color: "#fff" }}
                                  >
                                    {track.title ||
                                      track.trackName ||
                                      "Unknown Track"}
                                  </span>
                                </div>
                                <div className="flex items-center gap-2 flex-shrink-0">
                                  <span
                                    className="text-xs w-10 text-right tabular-nums"
                                    style={{ color: "#c1c1c3" }}
                                  >
                                    {durationLabel}
                                  </span>
                                  {onAddTrackToPlaylist ? (
                                    <button
                                      type="button"
                                      className="group inline-flex h-7 w-7 items-center overflow-hidden rounded-full transition-all duration-200 ease-out hover:w-[118px]"
                                      style={{
                                        backgroundColor: "rgba(255,255,255,0.06)",
                                        color: "#fff",
                                      }}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        onAddTrackToPlaylist(track, releaseGroup);
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
                                  {hasPreview && (
                                    <button
                                      type="button"
                                      className="w-7 h-7 rounded-full flex items-center justify-center transition-colors"
                                      style={{
                                        backgroundColor: "rgba(255,255,255,0.06)",
                                        color: "#fff",
                                      }}
                                      onClick={(e) =>
                                        handleTrackPreviewPlay(track, e)
                                      }
                                      title={
                                        isPlaying ? "Pause preview" : "Play preview"
                                      }
                                      aria-label={
                                        isPlaying ? "Pause preview" : "Play preview"
                                      }
                                    >
                                      {isLoadingPreview ? (
                                        <Loader className="w-3.5 h-3.5 animate-spin" />
                                      ) : isPlaying ? (
                                        <Pause className="w-3.5 h-3.5" />
                                      ) : (
                                        <Play className="w-3.5 h-3.5 ml-0.5" />
                                      )}
                                    </button>
                                  )}
                                  {track.hasFile ||
                                  status?.albumInfo?.statistics
                                    ?.percentOfTracks >= 100 ||
                                  status?.albumInfo?.statistics?.sizeOnDisk >
                                    0 ? (
                                    <span
                                      className="w-12 flex items-center justify-end"
                                      style={{ color: "#c1c1c3" }}
                                    >
                                      <CheckCircle className="w-4 h-4 text-green-500" />
                                    </span>
                                  ) : (
                                    <span className="w-12" />
                                  )}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <p
                          className="text-sm  italic py-4"
                          style={{ color: "#c1c1c3" }}
                        >
                          No tracks available
                        </p>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}

ArtistDetailsReleaseGroups.propTypes = {
  artist: PropTypes.object,
  selectedReleaseTypes: PropTypes.arrayOf(PropTypes.string),
  setSelectedReleaseTypes: PropTypes.func,
  primaryReleaseTypes: PropTypes.arrayOf(PropTypes.string),
  secondaryReleaseTypes: PropTypes.arrayOf(PropTypes.string),
  showFilterDropdown: PropTypes.bool,
  setShowFilterDropdown: PropTypes.func,
  loadingReleases: PropTypes.bool,
  albumCovers: PropTypes.object,
  expandedReleaseGroup: PropTypes.string,
  albumTracks: PropTypes.object,
  loadingTracks: PropTypes.object,
  getAlbumStatus: PropTypes.func,
  albumDropdownOpen: PropTypes.string,
  setAlbumDropdownOpen: PropTypes.func,
  handleReleaseGroupAlbumClick: PropTypes.func,
  canAddAlbum: PropTypes.bool,
  handleRequestAlbum: PropTypes.func,
  canDeleteAlbum: PropTypes.bool,
  handleDeleteAlbumClick: PropTypes.func,
  requestingAlbum: PropTypes.string,
  reSearchingAlbum: PropTypes.oneOfType([PropTypes.string, PropTypes.number]),
  canReSearchAlbum: PropTypes.bool,
  handleReSearchAlbum: PropTypes.func,
  previewVolume: PropTypes.number,
  isReleaseGroupDownloadedInLibrary: PropTypes.func,
  onAddTrackToPlaylist: PropTypes.func,
  onVisibleCoverIdsChange: PropTypes.func,
};
