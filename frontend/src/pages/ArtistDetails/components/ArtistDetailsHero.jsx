import { useState } from "react";
import PropTypes from "prop-types";
import {
  Loader,
  Music,
  ExternalLink,
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
  ChevronUp,
} from "lucide-react";
import { getCoverImage, getTagColor, formatLifeSpan, getArtistType } from "../utils";
import AddToLibraryButton from "../../../components/AddToLibraryButton";

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
  onNavigate,
  loadingPreview,
  previewTracks,
  previewAudioRef,
  playingPreviewId,
  previewProgress,
  previewSnappingBack,
  handlePreviewPlay,
  onEditIds,
  onToggleBlockArtist,
  blockingArtist,
  artistBlocked,
}) {
  const coverImage = getCoverImage(coverImages);
  const lifeSpan = formatLifeSpan(artist["life-span"]);
  const [showViewMenu, setShowViewMenu] = useState(false);
  const [mobilePreviewCollapsed, setMobilePreviewCollapsed] = useState(true);
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

  return (
    <div className="card mb-8 relative">
      <div className="flex flex-col md:flex-row gap-6">
        <div
          className="relative w-full h-72 overflow-hidden md:hidden"
          style={{ backgroundColor: "#211f27" }}
        >
          {loadingCover ? (
            <div className="w-full h-full flex items-center justify-center">
              <Loader
                className="w-12 h-12 animate-spin"
                style={{ color: "#c1c1c3" }}
              />
            </div>
          ) : coverImage ? (
            <img
              src={coverImage}
              alt={artist.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Music className="w-24 h-24" style={{ color: "#c1c1c3" }} />
            </div>
          )}
          <div
            className="absolute inset-0"
            style={{
              background:
                "linear-gradient(180deg, rgba(8,9,14,0.18) 0%, rgba(8,9,14,0.62) 56%, rgba(8,9,14,0.9) 100%)",
            }}
          />
          <div className="absolute inset-x-0 bottom-0 p-5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h1
                  className="text-4xl font-bold leading-tight"
                  style={{ color: "#fff" }}
                >
                  {artist.name}
                </h1>
                {artist.disambiguation && (
                  <p className="mt-2 text-sm italic line-clamp-2" style={{ color: "#d2d4da" }}>
                    {artist.disambiguation}
                  </p>
                )}
                {artist.bio && (
                  <p
                    className="mt-2 text-sm line-clamp-3 max-w-xl"
                    style={{ color: "#d2d4da" }}
                    title={artist.bio}
                  >
                    {artist.bio}
                  </p>
                )}
              </div>
            </div>
          </div>
        </div>

        <div
          className="hidden md:block w-full md:w-64 h-64 flex-shrink-0 overflow-hidden relative"
          style={{ backgroundColor: "#211f27" }}
        >
          {loadingCover ? (
            <div className="w-full h-full flex items-center justify-center">
              <Loader
                className="w-12 h-12 animate-spin"
                style={{ color: "#c1c1c3" }}
              />
            </div>
          ) : coverImage ? (
            <img
              src={coverImage}
              alt={artist.name}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center">
              <Music className="w-24 h-24" style={{ color: "#c1c1c3" }} />
            </div>
          )}
        </div>

        <div className="flex-1">
          <div className="hidden md:flex justify-between items-start gap-4">
            <div className="items-start gap-3 min-w-0 flex">
              <h1
                className="text-4xl font-bold mb-2"
                style={{ color: "#fff" }}
              >
                {artist.name}
              </h1>
              <button
                type="button"
                onClick={onEditIds}
                className="btn btn-secondary btn-sm p-2 inline-flex items-center flex-shrink-0 mt-1"
                aria-label="Edit IDs"
                title="Edit artist IDs"
              >
                <Pencil className="w-5 h-5" />
              </button>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {onToggleBlockArtist && (
                <button
                  type="button"
                  onClick={onToggleBlockArtist}
                  disabled={blockingArtist}
                  className="btn btn-secondary btn-sm p-2"
                  title={artistBlocked ? "Remove from blocklist" : "Add to blocklist"}
                >
                  {blockingArtist ? (
                    <Loader className="w-5 h-5 animate-spin" />
                  ) : (
                    <Ban
                      className="w-5 h-5"
                      style={{ color: artistBlocked ? "#f87171" : undefined }}
                    />
                  )}
                </button>
              )}
              {existsInLibrary && canRefreshArtist && (
                <button
                  onClick={handleRefreshArtist}
                  disabled={refreshingArtist}
                  className="btn btn-secondary btn-sm p-2"
                  title="Refresh & Scan Artist"
                >
                  {refreshingArtist ? (
                    <Loader className="w-5 h-5 animate-spin" />
                  ) : (
                    <RefreshCw className="w-5 h-5" />
                  )}
                </button>
              )}
            </div>
          </div>

          {artist["sort-name"] && artist["sort-name"] !== artist.name && (
            <p className="hidden md:block text-lg mb-4" style={{ color: "#c1c1c3" }}>
              {artist["sort-name"]}
            </p>
          )}

          {artist.disambiguation && (
            <p className="hidden md:block italic mb-4" style={{ color: "#c1c1c3" }}>
              {artist.disambiguation}
            </p>
          )}

          {artist.bio && (
            <p
              className="hidden md:block text-sm mb-4 line-clamp-6 max-w-2xl"
              style={{ color: "#c1c1c3" }}
              title={artist.bio}
            >
              {artist.bio}
            </p>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-6">
            {artist.type && (
              <div className="flex items-center" style={{ color: "#fff" }}>
                <Music
                  className="w-5 h-5 mr-2"
                  style={{ color: "#c1c1c3" }}
                />
                <span className="font-medium mr-2">Type:</span>
                <span>{getArtistType(artist.type)}</span>
              </div>
            )}

            {lifeSpan && (
              <div className="flex items-center" style={{ color: "#fff" }}>
                <Calendar
                  className="w-5 h-5 mr-2"
                  style={{ color: "#c1c1c3" }}
                />
                <span className="font-medium mr-2">Active:</span>
                <span>{lifeSpan}</span>
              </div>
            )}

            {artist.country && (
              <div className="flex items-center" style={{ color: "#fff" }}>
                <MapPin
                  className="w-5 h-5 mr-2"
                  style={{ color: "#c1c1c3" }}
                />
                <span className="font-medium mr-2">Country:</span>
                <span>{artist.country}</span>
              </div>
            )}

            {artist.area && artist.area.name && (
              <div className="flex items-center" style={{ color: "#fff" }}>
                <MapPin
                  className="w-5 h-5 mr-2"
                  style={{ color: "#c1c1c3" }}
                />
                <span className="font-medium mr-2">Area:</span>
                <span>{artist.area.name}</span>
              </div>
            )}
          </div>

          <div className="flex flex-wrap justify-center gap-3 md:justify-start">
            {loadingLibrary ? (
              <div
                className="btn btn-secondary inline-flex items-center"
                disabled
              >
                <Loader className="w-5 h-5 mr-2 animate-spin" />
                Loading...
              </div>
            ) : existsInLibrary ? (
              <>
                <div className="relative inline-flex">
                  {canChangeMonitoring || canDeleteArtist ? (
                    <>
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
                            className="absolute right-0 top-full w-56 z-20 py-1 rounded shadow-lg border border-white/10"
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
                                className="w-full text-left px-4 py-2 text-sm  hover:bg-gray-900/50 transition-colors flex items-center justify-between"
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
                                <div className=" my-1" />
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
                    </>
                  ) : (
                    <div className="btn btn-success inline-flex items-center cursor-default">
                      <CheckCircle className="w-5 h-5 mr-2" />
                      In Your Library
                    </div>
                  )}
                </div>
              </>
            ) : (
              canAddArtist && (
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
              )
            )}
            <div className="relative hidden md:inline-flex">
              <button
                type="button"
                onClick={() => setShowViewMenu(!showViewMenu)}
                className="btn btn-secondary inline-flex items-center"
              >
                <ExternalLink className="w-5 h-5 mr-2" />
                View on...
                <ChevronDown
                  className={`w-4 h-4 ml-2 transition-transform ${
                    showViewMenu ? "rotate-180" : ""
                  }`}
                />
              </button>
              {showViewMenu && (
                <>
                  <div
                    className="fixed inset-0 z-10"
                    onClick={() => setShowViewMenu(false)}
                  />
                  <div
                    className="absolute right-0 top-full mt-2 w-56 shadow-xl z-20 py-1 rounded-md border border-white/10"
                    style={{
                      backgroundColor: "#2d2b35",
                      boxShadow: "0 4px 20px rgba(0,0,0,0.4)",
                    }}
                  >
                    <a
                      href={`https://www.last.fm/music/${encodeURIComponent(
                        artist.name
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full text-left px-4 py-2 text-sm hover:bg-white/10 transition-colors flex items-center"
                      style={{ color: "#fff" }}
                      onClick={() => setShowViewMenu(false)}
                    >
                      <ExternalLink className="w-4 h-4 mr-2" />
                      View on Last.fm
                    </a>
                    {artist.id &&
                      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                        artist.id
                      ) && (
                        <a
                          href={`https://musicbrainz.org/artist/${artist.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="w-full text-left px-4 py-2 text-sm hover:bg-white/10 transition-colors flex items-center"
                          style={{ color: "#fff" }}
                          onClick={() => setShowViewMenu(false)}
                        >
                          <ExternalLink className="w-4 h-4 mr-2" />
                          View on MusicBrainz
                        </a>
                      )}
                    {lidarrArtistLink && (
                      <a
                        href={lidarrArtistLink}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full text-left px-4 py-2 text-sm hover:bg-white/10 transition-colors flex items-center"
                        style={{ color: "#fff" }}
                        onClick={() => setShowViewMenu(false)}
                      >
                        <ExternalLink className="w-4 h-4 mr-2" />
                        View on Lidarr
                      </a>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>

        {((!loadingPreview && previewTracks && previewTracks.length > 0) ||
          loadingPreview) && (
          <div className="w-full md:w-80 flex-shrink-0">
            <div
              className="rounded-xl border border-white/5 bg-white/[0.03] px-4 py-3"
            >
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold" style={{ color: "#fff" }}>
                Audio Preview
              </h3>
              <button
                type="button"
                onClick={() => setMobilePreviewCollapsed((value) => !value)}
                className="inline-flex items-center gap-1 text-xs md:hidden"
                style={{ color: "#c1c1c3" }}
                aria-expanded={!mobilePreviewCollapsed}
              >
                <span>{mobilePreviewCollapsed ? "Show" : "Hide"}</span>
                <ChevronUp
                  className={`w-4 h-4 transition-transform ${
                    mobilePreviewCollapsed ? "rotate-180" : ""
                  }`}
                />
              </button>
            </div>
            {!loadingPreview && previewTracks.length > 0 && (
              <>
                <audio ref={previewAudioRef} />
                <ul
                  className={`mt-3 space-y-0.5 ${
                    mobilePreviewCollapsed ? "hidden md:block" : "block"
                  }`}
                >
                  {previewTracks.map((track) => (
                    <li
                      key={track.id}
                      className="relative flex items-center gap-2 py-2 px-2 rounded hover:bg-black/30 transition-colors cursor-pointer overflow-hidden"
                      style={{
                        backgroundColor:
                          playingPreviewId === track.id
                            ? "rgba(0,0,0,0.12)"
                            : undefined,
                      }}
                      onClick={() => handlePreviewPlay(track)}
                    >
                      {playingPreviewId === track.id && (
                        <div
                          className="absolute inset-0 rounded pointer-events-none"
                          style={{
                            width: `${previewProgress * 100}%`,
                            backgroundColor: "rgba(112, 126, 97, 0.55)",
                            transition: previewSnappingBack
                              ? "width 0.28s cubic-bezier(0.34, 1.56, 0.64, 1)"
                              : "width 0.1s linear",
                            zIndex: 15,
                          }}
                        />
                      )}
                      <button
                        type="button"
                        className="relative z-10 flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center"
                        style={{ color: "#fff" }}
                        onClick={(e) => {
                          e.stopPropagation();
                          handlePreviewPlay(track);
                        }}
                      >
                        {playingPreviewId === track.id && !previewSnappingBack ? (
                          <Pause className="w-4 h-4" />
                        ) : (
                          <Play className="w-4 h-4 ml-0.5" />
                        )}
                      </button>
                      <div className="relative z-10 flex-1 min-w-0">
                        <div
                          className="text-sm font-medium truncate"
                          style={{ color: "#fff" }}
                        >
                          {track.title}
                        </div>
                        {track.album && (
                          <div
                            className="text-xs truncate"
                            style={{ color: "#c1c1c3" }}
                          >
                            {track.album}
                          </div>
                        )}
                      </div>
                      {track.duration_ms > 0 && (
                        <span
                          className="relative z-10 text-xs flex-shrink-0"
                          style={{ color: "#c1c1c3" }}
                        >
                          0:30
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
            </div>
          </div>
        )}
      </div>

      {artist && (
        <div className="mt-3 pt-3">
          <h3
            className="text-xs font-semibold uppercase tracking-wider mb-2"
            style={{ color: "#c1c1c3" }}
          >
            Tags
          </h3>
          <div className="flex gap-2 overflow-x-auto whitespace-nowrap pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden md:flex-wrap md:overflow-visible">
            {artist.genres &&
              artist.genres.map((genre, idx) => {
                const name = typeof genre === "string" ? genre : genre?.name;
                if (!name) return null;
                return (
                  <button
                    key={`genre-${idx}`}
                    onClick={() =>
                      onNavigate(
                        `/search?q=${encodeURIComponent(`#${name}`)}&type=tag`
                      )
                    }
                    className="badge genre-tag-pill text-sm px-3 py-1 cursor-pointer"
                    style={{
                      backgroundColor: getTagColor(name),
                      color: "#fff",
                    }}
                    title={`View artists with tag: ${name}`}
                  >
                    #{name}
                  </button>
                );
              })}
            {artist.tags &&
              artist.tags.map((tag, idx) => {
                const name = typeof tag === "string" ? tag : tag?.name;
                if (!name) return null;
                return (
                  <button
                    key={`tag-${idx}`}
                    onClick={() =>
                      onNavigate(
                        `/search?q=${encodeURIComponent(`#${name}`)}&type=tag`
                      )
                    }
                    className="badge genre-tag-pill text-sm px-3 py-1 cursor-pointer"
                    style={{
                      backgroundColor: getTagColor(name),
                      color: "#fff",
                    }}
                    title={`View artists with tag: ${name}`}
                  >
                    #{name}
                  </button>
                );
              })}
            {(!artist.genres || artist.genres.length === 0) &&
              (!artist.tags || artist.tags.length === 0) && (
                <span className="text-sm" style={{ color: "#c1c1c3" }}>
                  No tags
                </span>
              )}
          </div>
        </div>
      )}
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
  handlePreviewPlay: PropTypes.func,
  onEditIds: PropTypes.func,
  onToggleBlockArtist: PropTypes.func,
  blockingArtist: PropTypes.bool,
  artistBlocked: PropTypes.bool,
};
