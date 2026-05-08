import PropTypes from "prop-types";
import { useState } from "react";
import { Loader2, Music } from "lucide-react";

function getAlbumActionLabel(album, isPending, canAddAlbum) {
  if (!canAddAlbum) return "No Access";
  if (isPending || ["searching", "downloading", "processing"].includes(album.status)) {
    return "Searching...";
  }
  if (album.status === "available") return "In Library";
  if (album.status === "inLibrary") return "Search Album";
  return "Add Album";
}

function isAlbumActionDisabled(album, isPending, canAddAlbum) {
  if (!canAddAlbum) return true;
  if (album.status === "available") return true;
  return isPending || ["searching", "downloading", "processing"].includes(album.status);
}

function AlbumCover({ src, alt }) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return <Music className="h-8 w-8" />;
  }

  return (
    <img
      src={src}
      alt={alt}
      className="h-full w-full object-cover"
      loading="lazy"
      decoding="async"
      onError={() => setFailed(true)}
    />
  );
}

function SearchAlbumResults({
  albums,
  albumCovers,
  canAddAlbum,
  pendingAlbumIds,
  onAlbumAction,
  navigate,
}) {
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
      {albums.map((album) => {
        const isPending = !!pendingAlbumIds[album.id];
        const actionDisabled = isAlbumActionDisabled(
          album,
          isPending,
          canAddAlbum,
        );

        return (
          <div
            key={album.id}
            className="overflow-hidden border border-white/5"
            style={{ backgroundColor: "#17161b" }}
          >
            <div className="flex gap-4 p-4">
              <div
                className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden"
                style={{ backgroundColor: "#211f27", color: "#8a8a8f" }}
              >
                <AlbumCover
                  src={albumCovers[album.id] || album.coverUrl}
                  alt={album.title}
                />
              </div>

              <div className="min-w-0 flex-1">
                <div className="mb-2 flex flex-wrap items-start gap-2">
                  <h3
                    className="min-w-0 flex-1 truncate text-lg font-semibold"
                    style={{ color: "#fff" }}
                    title={album.title}
                  >
                    {album.title}
                  </h3>
                  <span
                    className="px-2 py-1 text-[11px] uppercase tracking-wide"
                    style={{
                      backgroundColor:
                        album.status === "available"
                          ? "rgba(34,197,94,0.18)"
                          : album.status === "inLibrary"
                            ? "rgba(245,158,11,0.18)"
                            : album.status === "searching"
                              ? "rgba(59,130,246,0.18)"
                              : "rgba(255,255,255,0.08)",
                      color:
                        album.status === "available"
                          ? "#86efac"
                          : album.status === "inLibrary"
                            ? "#fcd34d"
                            : album.status === "searching"
                              ? "#93c5fd"
                              : "#c1c1c3",
                    }}
                  >
                    {album.status === "inLibrary"
                      ? "In Library"
                      : album.status === "available"
                        ? "Available"
                        : album.status === "searching"
                          ? "Searching"
                          : "Missing"}
                  </span>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    album.artistMbid &&
                    navigate(`/artist/${album.artistMbid}`, {
                      state: { artistName: album.artistName },
                    })
                  }
                  className="truncate text-left text-sm hover:underline"
                  style={{ color: "#d1d1d4" }}
                  disabled={!album.artistMbid}
                  title={album.artistName}
                >
                  {album.artistName}
                </button>

                <div
                  className="mt-2 flex flex-wrap gap-2 text-xs"
                  style={{ color: "#9c9ca1" }}
                >
                  {album.releaseDate && <span>{album.releaseDate}</span>}
                  {album.primaryType && <span>{album.primaryType}</span>}
                  {album.secondaryTypes?.map((secondaryType) => (
                    <span key={`${album.id}-${secondaryType}`}>
                      {secondaryType}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div
              className="flex flex-wrap gap-3 border-t border-white/5 p-4"
              style={{ backgroundColor: "#141318" }}
            >
              <button
                type="button"
                className="btn btn-primary"
                onClick={() => onAlbumAction(album)}
                disabled={actionDisabled}
              >
                <span className="flex items-center gap-2">
                  {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                  {getAlbumActionLabel(album, isPending, canAddAlbum)}
                </span>
              </button>
              <button
                type="button"
                className="btn btn-secondary"
                onClick={() =>
                  album.artistMbid &&
                  navigate(`/artist/${album.artistMbid}`, {
                    state: { artistName: album.artistName },
                  })
                }
                disabled={!album.artistMbid}
              >
                Open Artist
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

SearchAlbumResults.propTypes = {
  albums: PropTypes.arrayOf(PropTypes.object).isRequired,
  albumCovers: PropTypes.object.isRequired,
  canAddAlbum: PropTypes.bool.isRequired,
  pendingAlbumIds: PropTypes.object.isRequired,
  onAlbumAction: PropTypes.func.isRequired,
  navigate: PropTypes.func.isRequired,
};

export default SearchAlbumResults;
