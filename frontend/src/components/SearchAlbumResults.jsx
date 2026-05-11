import PropTypes from "prop-types";
import { useState } from "react";
import { Check, Loader2, Music, Plus, Search } from "lucide-react";

function getAlbumActionLabel(album, isPending, canAddAlbum) {
  if (!canAddAlbum) return "No Access";
  if (isPending || ["searching", "downloading", "processing"].includes(album.status)) {
    return "Searching...";
  }
  if (album.status === "available") return "In Library";
  if (album.status === "inLibrary") return "Search Album";
  return "Add to Lidarr";
}

function isAlbumActionDisabled(album, isPending, canAddAlbum) {
  if (!canAddAlbum) return true;
  return isPending || ["searching", "downloading", "processing"].includes(album.status);
}

function getAlbumActionIcon(album, isPending) {
  if (isPending) return Loader2;
  if (album.status === "available") return Check;
  if (album.status === "inLibrary") return Search;
  return Plus;
}

function getReleaseYear(releaseDate) {
  const value = String(releaseDate || "").trim();
  if (!value) return null;
  return value.split("-")[0] || null;
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
      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
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
  const openArtist = (album) => {
    if (!album.artistMbid) return;
    navigate(`/artist/${album.artistMbid}`, {
      state: { artistName: album.artistName },
    });
  };

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
      {albums.map((album) => {
        const isPending = !!pendingAlbumIds[album.id];
        const actionDisabled = isAlbumActionDisabled(
          album,
          isPending,
          canAddAlbum,
        );
        const AlbumActionIcon = getAlbumActionIcon(album, isPending);
        const releaseYear = getReleaseYear(album.releaseDate);
        const releaseType =
          album.primaryType || album.secondaryTypes?.[0] || null;
        const handlePrimaryAction = () => {
          if (album.status === "available") {
            openArtist(album);
            return;
          }
          onAlbumAction(album);
        };

        return (
          <div
            key={album.id}
            className="group min-w-0"
          >
            <div
              className="relative aspect-square overflow-hidden border border-white/8"
              style={{ backgroundColor: "#17161b" }}
            >
              <button
                type="button"
                onClick={() => openArtist(album)}
                className="absolute inset-0 z-[1] cursor-pointer"
                aria-label={`Open artist page for ${album.artistName}`}
                title={`Open artist: ${album.artistName}`}
              />

              <div
                className="absolute inset-0"
                style={{ backgroundColor: "#211f27", color: "#8a8a8f" }}
              >
                <AlbumCover
                  src={albumCovers[album.id] || album.coverUrl}
                  alt={album.title}
                />
              </div>

              <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-transparent to-black/75" />

              <div className="absolute inset-x-0 top-0 z-10 flex items-start justify-between p-2">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handlePrimaryAction}
                    disabled={actionDisabled}
                    className="inline-flex h-9 w-9 items-center overflow-hidden border border-white/10 backdrop-blur-sm transition-all duration-200 ease-out hover:w-[142px] disabled:cursor-not-allowed [&:hover_.album-action-label]:translate-x-0 [&:hover_.album-action-label]:opacity-100"
                    style={{
                      backgroundColor:
                        album.status === "available"
                          ? "rgba(112,126,97,0.9)"
                        : "rgba(20,19,24,0.78)",
                      color: album.status === "available" ? "#ffffff" : "#fff",
                      opacity: actionDisabled && album.status !== "available" ? 0.5 : 1,
                    }}
                    aria-label={getAlbumActionLabel(album, isPending, canAddAlbum)}
                    title={getAlbumActionLabel(album, isPending, canAddAlbum)}
                  >
                    <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center">
                      <AlbumActionIcon
                        className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`}
                      />
                    </span>
                    <span className="album-action-label pr-3 text-xs font-medium whitespace-nowrap opacity-0 transition-all duration-150 ease-out -translate-x-2">
                      {getAlbumActionLabel(album, isPending, canAddAlbum)}
                    </span>
                  </button>
                </div>

              </div>

              <div
                className="absolute inset-x-0 bottom-0 z-10 flex items-center justify-between gap-3 p-2 text-[11px] uppercase tracking-[0.16em]"
                style={{
                  background:
                    "linear-gradient(to top, rgba(18,17,22,0.92), rgba(18,17,22,0.55), transparent)",
                  color: "#d4d4d8",
                }}
              >
                <span className="truncate text-left">
                  {releaseType || ""}
                </span>
                <span className="shrink-0 text-right">
                  {releaseYear || ""}
                </span>
              </div>
            </div>

            <div className="min-w-0 px-1 pb-1 pt-2">
              <button
                type="button"
                onClick={() => openArtist(album)}
                className="block w-full text-left transition-opacity hover:opacity-80 disabled:cursor-pointer"
                title={`${album.title} — ${album.artistName}`}
              >
                <span
                  className="block truncate text-base font-semibold"
                  style={{ color: "#fff" }}
                >
                  {album.title}
                </span>
                <span
                  className="mt-0.5 block truncate text-sm"
                  style={{ color: "#b9b9be" }}
                >
                  {album.artistName}
                </span>
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
