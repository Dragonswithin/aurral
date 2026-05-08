import { useEffect, useState } from "react";
import PropTypes from "prop-types";
import {
  Loader,
  Music,
  CheckCircle,
  RefreshCw,
  ChevronDown,
  SlidersHorizontal,
  Calendar,
  MapPin,
  Trash2,
  Play,
  Pause,
  Pencil,
  Ban,
  MoreHorizontal,
  Volume2,
  VolumeX,
} from "lucide-react";
import { getCoverImage, getTagColor, formatLifeSpan, getArtistType } from "../utils";
import AddToLibraryButton from "../../../components/AddToLibraryButton";
import lidarrLogo from "../../../../images/logos/lidarr.svg?raw";
import lastFmLogo from "../../../../images/logos/last-fm.svg?raw";
import musicBrainzLogo from "../../../../images/logos/musicbrainz.svg?raw";
import listenBrainzLogo from "../../../../images/logos/listenbrainz.svg?raw";

const toCurrentColorSvg = (svg) =>
  svg
    .replace(/fill:#fff/gi, "fill:currentColor")
    .replace(/fill="#fff"/gi, 'fill="currentColor"')
    .replace(/fill:#ffffff/gi, "fill:currentColor")
    .replace(/fill="#ffffff"/gi, 'fill="currentColor"');

export function ArtistDetailsHero({
  artist,
  libraryArtist,
  appSettings,
  coverImages,
  loadingCover,
  loadingLibrary,
  existsInLibrary,
  showRemoveDropdown,
  setShowRemoveDropdown,
  showMonitorOptionMenu,
  setShowMonitorOptionMenu,
  updatingMonitor,
  canChangeMonitoring,
  getCurrentMonitorOption,
  handleUpdateMonitorOption,
  canDeleteArtist,
  handleDeleteClick,
  canAddArtist,
  handleAddToLibrary,
  handleOpenAddCustomizeModal,
  addingToLibrary,
  canRefreshArtist,
  handleRefreshArtist,
  refreshingArtist,
  onCoverError,
  onNavigate,
  loadingPreview,
  previewTracks,
  previewAudioRef,
  playingPreviewId,
  previewProgress,
  previewSnappingBack,
  previewVolume,
  setPreviewVolume,
  handlePreviewPlay,
  onEditIds,
  onToggleBlockArtist,
  blockingArtist,
  artistBlocked,
}) {
  const coverImage = getCoverImage(coverImages);
  const lifeSpan = formatLifeSpan(artist["life-span"]);
  const [showHeroMenu, setShowHeroMenu] = useState(false);
  const [coverFailed, setCoverFailed] = useState(false);
  const lidarrArtistId =
    artist?.id ||
    libraryArtist?.foreignArtistId ||
    libraryArtist?.mbid ||
    artist?._lidarrData?.foreignArtistId;
  const lidarrUrl =
    appSettings?.integrations?.lidarr?.externalUrl ||
    appSettings?.integrations?.lidarr?.url;
  const lidarrArtistLink =
    lidarrUrl && lidarrArtistId
      ? `${lidarrUrl.replace(/\/$/, "")}/${
          existsInLibrary
            ? `artist/${lidarrArtistId}`
            : `add/search?term=lidarr:${encodeURIComponent(lidarrArtistId)}`
        }`
      : null;
  const hasPreview = loadingPreview || (previewTracks && previewTracks.length > 0);
  useEffect(() => {
    setCoverFailed(false);
  }, [coverImage]);
  const metadataItems = [
    artist.type
      ? {
          key: "type",
          icon: Music,
          label: "Type",
          value: getArtistType(artist.type),
        }
      : null,
    lifeSpan
      ? {
          key: "active",
          icon: Calendar,
          label: "Active",
          value: lifeSpan,
        }
      : null,
    artist.country
      ? {
          key: "country",
          icon: MapPin,
          label: "Country",
          value: artist.country,
        }
      : null,
    artist.area?.name
      ? {
          key: "area",
          icon: MapPin,
          label: "Area",
          value: artist.area.name,
        }
      : null,
  ].filter(Boolean);
  const tags = [
    ...(Array.isArray(artist.genres) ? artist.genres : []).map((genre, idx) => ({
      key: `genre-${idx}`,
      name: typeof genre === "string" ? genre : genre?.name,
    })),
    ...(Array.isArray(artist.tags) ? artist.tags : []).map((tag, idx) => ({
      key: `tag-${idx}`,
      name: typeof tag === "string" ? tag : tag?.name,
    })),
  ].filter((tag) => tag.name);
  const externalLinks = [
    lidarrArtistLink
      ? {
          key: "lidarr",
          label: "Lidarr",
          href: lidarrArtistLink,
          logo: toCurrentColorSvg(lidarrLogo),
          color: "#009252",
        }
      : null,
    {
      key: "lastfm",
      label: "Last.fm",
      href: `https://www.last.fm/music/${encodeURIComponent(artist.name)}`,
      logo: toCurrentColorSvg(lastFmLogo),
      color: "#D1170D",
    },
    artist.id &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      artist.id
    )
      ? {
          key: "musicbrainz",
          label: "MusicBrainz",
          href: `https://musicbrainz.org/artist/${artist.id}`,
          logo: toCurrentColorSvg(musicBrainzLogo),
          color: "#BA478F",
        }
      : null,
    artist.id &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      artist.id
    )
      ? {
          key: "listenbrainz",
          label: "ListenBrainz",
          href: `https://listenbrainz.org/artist/${encodeURIComponent(artist.id)}/`,
          logo: toCurrentColorSvg(listenBrainzLogo),
          color: "#353070",
        }
      : null,
  ].filter(Boolean);

  const renderLibraryAction = () => {
    if (loadingLibrary) {
      return (
        <div className="btn btn-secondary inline-flex items-center">
          <Loader className="w-5 h-5 mr-2 animate-spin" />
          {existsInLibrary ? "Loading Library..." : "Checking Lidarr..."}
        </div>
      );
    }

    if (existsInLibrary) {
      if (canChangeMonitoring || canDeleteArtist) {
        return (
          <div className="relative inline-flex">
            <button
              type="button"
              onClick={() => setShowRemoveDropdown(!showRemoveDropdown)}
              className="btn btn-success inline-flex items-center"
            >
              <CheckCircle className="w-5 h-5 mr-2" />
              In Your Library
              <ChevronDown
                className={`w-4 h-4 ml-2 transition-transform ${
                  showRemoveDropdown ? "rotate-180" : ""
                }`}
              />
            </button>
            {showRemoveDropdown && (
              <>
                <div
                  className="fixed inset-0 z-10"
                  onClick={() => setShowRemoveDropdown(false)}
                />
                <div
                  className="absolute left-0 top-full mt-2 w-56 z-20 py-1 rounded shadow-lg border border-white/10"
                  style={{ backgroundColor: "#2a2830" }}
                  onClick={(e) => e.stopPropagation()}
                >
                  {canChangeMonitoring && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setShowMonitorOptionMenu(!showMonitorOptionMenu);
                      }}
                      disabled={updatingMonitor}
                      className="w-full text-left px-4 py-2 text-sm hover:bg-gray-900/50 transition-colors flex items-center justify-between"
                      style={{ color: "#fff" }}
                    >
                      <span>Change Monitor Option</span>
                      <ChevronDown
                        className={`w-4 h-4 transition-transform ${
                          showMonitorOptionMenu ? "rotate-180" : ""
                        }`}
                      />
                    </button>
                  )}

                  {canChangeMonitoring && showMonitorOptionMenu && (
                    <>
                      <div className="my-1" />
                      {[
                        { value: "none", label: "None (Artist Only)" },
                        { value: "all", label: "All Albums" },
                        { value: "future", label: "Future Albums" },
                        { value: "missing", label: "Missing Albums" },
                        { value: "latest", label: "Latest Album" },
                        { value: "first", label: "First Album" },
                      ].map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleUpdateMonitorOption(option.value);
                            setShowMonitorOptionMenu(false);
                            setShowRemoveDropdown(false);
                          }}
                          disabled={updatingMonitor}
                          className="w-full text-left px-4 py-2 text-sm hover:bg-gray-900/50 transition-colors"
                          style={
                            getCurrentMonitorOption() === option.value
                              ? {
                                  backgroundColor: "#211f27",
                                  color: "#fff",
                                  fontWeight: "500",
                                }
                              : { color: "#fff" }
                          }
                        >
                          {option.label}
                        </button>
                      ))}
                    </>
                  )}

                  {canDeleteArtist && (
                    <>
                      <div className="my-1" />
                      <button
                        type="button"
                        onClick={() => {
                          handleDeleteClick();
                          setShowRemoveDropdown(false);
                        }}
                        className="w-full text-left px-4 py-2 text-sm text-red-400 hover:bg-red-500/20 transition-colors flex items-center"
                      >
                        <Trash2 className="w-4 h-4 mr-2" />
                        Remove from Library
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        );
      }

      return (
        <div className="btn btn-success inline-flex items-center cursor-default">
          <CheckCircle className="w-5 h-5 mr-2" />
          In Your Library
        </div>
      );
    }

    if (!canAddArtist) return null;

    return (
      <div className="add-to-library-button-group">
        <AddToLibraryButton
          onClick={handleAddToLibrary}
          isLoading={addingToLibrary}
          className="add-to-library-button--split"
        />
        <button
          type="button"
          onClick={handleOpenAddCustomizeModal}
          disabled={addingToLibrary}
          className="add-to-library-button-split-trigger"
          aria-label="Customize add options"
          title="Customize add options"
        >
          <SlidersHorizontal className="w-4 h-4" />
        </button>
      </div>
    );
  };

  const hasHeroMenuActions =
    Boolean(onEditIds) || Boolean(onToggleBlockArtist) || (existsInLibrary && canRefreshArtist);

  const renderHeroMenu = () => {
    if (!hasHeroMenuActions) return null;

    return (
      <div className="relative">
        <button
          type="button"
          onClick={() => setShowHeroMenu((value) => !value)}
          className="btn btn-sm p-2 inline-flex items-center hover:bg-white/5"
          style={{ backgroundColor: "transparent", color: "#fff" }}
          aria-label="More artist actions"
          title="More artist actions"
        >
          <MoreHorizontal className="w-5 h-5" />
        </button>
        {showHeroMenu && (
          <>
            <div
              className="fixed inset-0 z-10"
              onClick={() => setShowHeroMenu(false)}
            />
            <div
              className="absolute right-0 top-full mt-2 w-56 z-20 rounded-md border border-white/10 py-1 shadow-xl"
              style={{
                backgroundColor: "#2d2b35",
                boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
              }}
            >
              {onEditIds && (
                <button
                  type="button"
                  onClick={() => {
                    onEditIds();
                    setShowHeroMenu(false);
                  }}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-white/10 transition-colors flex items-center"
                  style={{ color: "#fff" }}
                >
                  <Pencil className="w-4 h-4 mr-2" />
                  Edit IDs
                </button>
              )}
              {onToggleBlockArtist && (
                <button
                  type="button"
                  onClick={() => {
                    onToggleBlockArtist();
                    setShowHeroMenu(false);
                  }}
                  disabled={blockingArtist}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-white/10 transition-colors flex items-center disabled:opacity-60"
                  style={{ color: artistBlocked ? "#fca5a5" : "#fff" }}
                >
                  {blockingArtist ? (
                    <Loader className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <Ban className="w-4 h-4 mr-2" />
                  )}
                  {artistBlocked ? "Remove from Blocklist" : "Add to Blocklist"}
                </button>
              )}
              {existsInLibrary && canRefreshArtist && (
                <button
                  type="button"
                  onClick={() => {
                    handleRefreshArtist();
                    setShowHeroMenu(false);
                  }}
                  disabled={refreshingArtist}
                  className="w-full text-left px-4 py-2 text-sm hover:bg-white/10 transition-colors flex items-center disabled:opacity-60"
                  style={{ color: "#fff" }}
                >
                  {refreshingArtist ? (
                    <Loader className="w-4 h-4 mr-2 animate-spin" />
                  ) : (
                    <RefreshCw className="w-4 h-4 mr-2" />
                  )}
                  Refresh & Scan Artist
                </button>
              )}
            </div>
          </>
        )}
      </div>
    );
  };

  const renderPreviewPanel = () => {
    if (!hasPreview) return null;

    return (
      <div
        className="w-full xl:w-[320px] xl:max-w-[320px] rounded-[22px] border border-white/10 p-4"
        style={{ boxShadow: "0 16px 40px rgba(0,0,0,0.24)" }}
      >
        <div className="flex items-center justify-between">
          <div />
        </div>
        {!loadingPreview && previewTracks.length > 0 && <audio ref={previewAudioRef} />}
        <div className="mt-4">
          <div className="mb-3 hidden md:flex">
            <div className="flex w-full items-center gap-3 rounded-full border border-white/10 bg-black/20 px-3 py-2">
              {previewVolume <= 0 ? (
                <VolumeX className="w-4 h-4 flex-shrink-0" style={{ color: "#c1c1c3" }} />
              ) : (
                <Volume2 className="w-4 h-4 flex-shrink-0" style={{ color: "#c1c1c3" }} />
              )}
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={Math.round(previewVolume * 100)}
                onChange={(e) =>
                  setPreviewVolume(
                    Math.max(0, Math.min(1, Number(e.target.value) / 100))
                  )
                }
                className="volume-slider min-w-0 flex-1"
                aria-label="Preview volume"
              />
              <span
                className="w-8 text-right text-xs tabular-nums"
                style={{ color: "#c1c1c3" }}
              >
                {Math.round(previewVolume * 100)}
              </span>
            </div>
          </div>
          {loadingPreview ? (
            <div className="flex items-center justify-center py-10">
              <Loader className="w-6 h-6 animate-spin" style={{ color: "#c1c1c3" }} />
            </div>
          ) : (
            <ul className="space-y-2">
              {previewTracks.map((track) => (
                <li
                  key={track.id}
                  className="relative overflow-hidden rounded-2xl border border-white/5 bg-white/[0.03] transition-colors hover:bg-white/[0.06]"
                >
                  {playingPreviewId === track.id && (
                    <div
                      className="absolute inset-y-0 left-0 pointer-events-none"
                      style={{
                        width: `${previewProgress * 100}%`,
                        background:
                          "linear-gradient(90deg, rgba(112,126,97,0.42) 0%, rgba(112,126,97,0.12) 100%)",
                        transition: previewSnappingBack
                          ? "width 0.28s cubic-bezier(0.34, 1.56, 0.64, 1)"
                          : "width 0.1s linear",
                      }}
                    />
                  )}
                  <button
                    type="button"
                    className="relative z-10 flex w-full items-center gap-3 px-3 py-3 text-left"
                    onClick={() => handlePreviewPlay(track)}
                  >
                    <span
                      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border border-white/10 bg-black/25"
                      style={{ color: "#fff" }}
                    >
                      {playingPreviewId === track.id && !previewSnappingBack ? (
                        <Pause className="w-4 h-4" />
                      ) : (
                        <Play className="w-4 h-4 ml-0.5" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium" style={{ color: "#fff" }}>
                        {track.title}
                      </span>
                      <span className="block truncate text-xs" style={{ color: "#c1c1c3" }}>
                        {track.album || "Preview available"}
                      </span>
                    </span>
                    <span className="text-xs tabular-nums" style={{ color: "#c1c1c3" }}>
                      {track.duration_ms > 0 ? "0:30" : ""}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      className="card mb-8 relative overflow-hidden p-0"
      style={{
        background:
          "linear-gradient(180deg, rgba(33,31,39,0.98) 0%, rgba(29,28,35,0.98) 100%)",
      }}
    >
      {coverImage && !coverFailed && (
        <>
          <div
            className="absolute inset-0 opacity-30"
            style={{
              backgroundImage: `url(${coverImage})`,
              backgroundSize: "cover",
              backgroundPosition: "center",
              filter: "blur(10px)",
              transform: "scale(1.08)",
            }}
          />
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(circle at top left, rgba(112,126,97,0.2) 0%, rgba(33,31,39,0) 36%), linear-gradient(135deg, rgba(7,8,11,0.18) 0%, rgba(7,8,11,0.58) 46%, rgba(16,17,22,0.9) 100%)",
            }}
          />
        </>
      )}

      <div className="relative px-4 py-5 md:px-6 md:py-6">
        <div className="flex flex-col gap-5 xl:flex-row xl:items-stretch">
          <div className="min-w-0 flex-1 rounded-[26px] border border-white/10 p-4 md:p-6">
            <div className="flex flex-col items-center gap-5 lg:flex-row lg:items-end lg:justify-start">
              <div
                className="relative h-40 w-40 flex-shrink-0 overflow-hidden rounded-[22px] border border-white/10 bg-[#211f27] shadow-2xl sm:h-48 sm:w-48"
                style={{ boxShadow: "0 18px 42px rgba(0,0,0,0.35)" }}
              >
                {loadingCover ? (
                  <div className="flex h-full w-full items-center justify-center">
                    <Loader className="w-10 h-10 animate-spin" style={{ color: "#c1c1c3" }} />
                  </div>
                ) : coverImage && !coverFailed ? (
                  <img
                    src={coverImage}
                    alt={artist.name}
                    className="h-full w-full object-cover"
                    loading="eager"
                    decoding="async"
                    onError={() => {
                      setCoverFailed(true);
                      onCoverError?.();
                    }}
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center">
                    <Music className="w-16 h-16" style={{ color: "#c1c1c3" }} />
                  </div>
                )}
              </div>

              <div className="min-w-0 flex-1 self-stretch">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-start gap-2">
                      <h1
                        className="min-w-0 text-4xl font-bold leading-none sm:text-5xl"
                        style={{ color: "#fff" }}
                      >
                        {artist.name}
                      </h1>
                    </div>
                    {artist["sort-name"] && artist["sort-name"] !== artist.name && (
                      <p className="mt-2 text-sm sm:text-base" style={{ color: "#c1c1c3" }}>
                        {artist["sort-name"]}
                      </p>
                    )}
                    {artist.disambiguation && (
                      <p className="mt-3 max-w-2xl text-sm italic sm:text-base" style={{ color: "#d5d6db" }}>
                        {artist.disambiguation}
                      </p>
                    )}
                  </div>

                  {renderHeroMenu()}
                </div>

                {artist.bio && (
                  <p
                    className="mt-4 max-w-3xl text-sm leading-7 text-white/80 line-clamp-4"
                    title={artist.bio}
                  >
                    {artist.bio}
                  </p>
                )}

                {metadataItems.length > 0 && (
                  <div className="mt-5 flex flex-wrap gap-2">
                    {metadataItems.map((item) => {
                      const Icon = item.icon;
                      return (
                        <div
                          key={item.key}
                          className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-black/15 px-3 py-2 text-sm"
                          style={{ color: "#fff" }}
                        >
                          <Icon className="w-4 h-4 flex-shrink-0" style={{ color: "#c1c1c3" }} />
                          <span className="font-medium" style={{ color: "#c1c1c3" }}>
                            {item.label}
                          </span>
                          <span>{item.value}</span>
                        </div>
                      );
                    })}
                  </div>
                )}

                <div className="mt-5 flex flex-wrap items-center gap-3">
                  {renderLibraryAction()}
                </div>
              </div>
            </div>

            <div className="mt-5 flex gap-2 overflow-x-auto whitespace-nowrap pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:flex-wrap md:overflow-visible">
              {tags.length > 0 ? (
                tags.map((tag) => (
                  <button
                    key={tag.key}
                    onClick={() =>
                      onNavigate(`/search?q=${encodeURIComponent(`#${tag.name}`)}&type=tag`)
                    }
                    className="badge genre-tag-pill shrink-0 px-3 py-1.5 text-sm cursor-pointer"
                    style={{
                      backgroundColor: getTagColor(tag.name),
                      color: "#fff",
                    }}
                    title={`View artists with tag: ${tag.name}`}
                  >
                    #{tag.name}
                  </button>
                ))
              ) : (
                <span className="text-sm" style={{ color: "#c1c1c3" }}>
                  No tags
                </span>
              )}
            </div>

            {externalLinks.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
                {externalLinks.map((link) => (
                  <a
                    key={link.key}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-2 text-sm transition-opacity hover:opacity-100"
                    style={{ color: "#d5d6db", opacity: 0.92 }}
                  >
                    <span
                      className="flex h-4 w-4 flex-shrink-0 items-center justify-center [&_svg]:h-full [&_svg]:w-full"
                      style={{ color: link.color }}
                      aria-hidden="true"
                      dangerouslySetInnerHTML={{ __html: link.logo }}
                    />
                    <span>{link.label}</span>
                  </a>
                ))}
              </div>
            )}
          </div>

          {renderPreviewPanel()}
        </div>
      </div>
    </div>
  );
}

ArtistDetailsHero.propTypes = {
  artist: PropTypes.object.isRequired,
  libraryArtist: PropTypes.object,
  appSettings: PropTypes.object,
  coverImages: PropTypes.arrayOf(
    PropTypes.shape({
      front: PropTypes.bool,
      image: PropTypes.string,
    })
  ),
  loadingCover: PropTypes.bool,
  loadingLibrary: PropTypes.bool,
  existsInLibrary: PropTypes.bool,
  showRemoveDropdown: PropTypes.bool,
  setShowRemoveDropdown: PropTypes.func,
  showMonitorOptionMenu: PropTypes.bool,
  setShowMonitorOptionMenu: PropTypes.func,
  updatingMonitor: PropTypes.bool,
  canChangeMonitoring: PropTypes.bool,
  getCurrentMonitorOption: PropTypes.func,
  handleUpdateMonitorOption: PropTypes.func,
  canDeleteArtist: PropTypes.bool,
  handleDeleteClick: PropTypes.func,
  canAddArtist: PropTypes.bool,
  handleAddToLibrary: PropTypes.func,
  handleOpenAddCustomizeModal: PropTypes.func,
  addingToLibrary: PropTypes.bool,
  canRefreshArtist: PropTypes.bool,
  handleRefreshArtist: PropTypes.func,
  refreshingArtist: PropTypes.bool,
  onCoverError: PropTypes.func,
  onNavigate: PropTypes.func,
  loadingPreview: PropTypes.bool,
  previewTracks: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string.isRequired,
      title: PropTypes.string.isRequired,
      album: PropTypes.string,
      duration_ms: PropTypes.number,
    })
  ),
  previewAudioRef: PropTypes.oneOfType([
    PropTypes.func,
    PropTypes.shape({ current: PropTypes.instanceOf(Element) }),
  ]),
  playingPreviewId: PropTypes.string,
  previewProgress: PropTypes.number,
  previewSnappingBack: PropTypes.bool,
  previewVolume: PropTypes.number,
  setPreviewVolume: PropTypes.func,
  handlePreviewPlay: PropTypes.func,
  onEditIds: PropTypes.func,
  onToggleBlockArtist: PropTypes.func,
  blockingArtist: PropTypes.bool,
  artistBlocked: PropTypes.bool,
};
