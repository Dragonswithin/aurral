import { useCallback, useEffect, useMemo, useState } from "react";
import PropTypes from "prop-types";
import { Loader, ChevronLeft, ChevronRight, CheckCircle2 } from "lucide-react";
import ArtistImage from "../../../components/ArtistImage";
import {
  lookupArtistsInLibraryBatch,
  readLibraryLookupCache,
} from "../../../utils/api";

const getArtistId = (artist) =>
  artist?.id || artist?.mbid || artist?.foreignArtistId;

export function ArtistDetailsSimilar({
  loadingSimilar,
  similarArtists,
  similarArtistsScrollRef,
  onArtistClick,
}) {
  const [libraryLookup, setLibraryLookup] = useState({});
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const artistIds = useMemo(
    () => similarArtists.map(getArtistId).filter(Boolean),
    [similarArtists],
  );

  const updateScrollState = useCallback(() => {
    const node = similarArtistsScrollRef?.current;
    if (!node) return;
    const maxScrollLeft = Math.max(node.scrollWidth - node.clientWidth, 0);
    setCanScrollLeft(node.scrollLeft > 2);
    setCanScrollRight(node.scrollLeft < maxScrollLeft - 2);
  }, [similarArtistsScrollRef]);

  const scrollByAmount = useCallback(
    (direction) => {
      const node = similarArtistsScrollRef?.current;
      if (!node) return;
      const width = node.clientWidth;
      node.scrollBy({
        left: direction * Math.max(width * 0.85, 280),
        behavior: "smooth",
      });
    },
    [similarArtistsScrollRef],
  );

  useEffect(() => {
    const cached = readLibraryLookupCache(artistIds);
    setLibraryLookup(cached);
    const missing = artistIds.filter((id) => cached[id] === undefined);
    if (missing.length === 0) return;
    let cancelled = false;
    const fetchLookup = async () => {
      try {
        const lookup = await lookupArtistsInLibraryBatch(missing);
        if (!cancelled && lookup) {
          setLibraryLookup((prev) => ({ ...prev, ...lookup }));
        }
      } catch {
        if (!cancelled) {
          setLibraryLookup((prev) => ({ ...prev }));
        }
      }
    };
    fetchLookup();
    return () => {
      cancelled = true;
    };
  }, [artistIds]);

  useEffect(() => {
    const node = similarArtistsScrollRef?.current;
    if (!node) return;
    updateScrollState();
    node.addEventListener("scroll", updateScrollState, { passive: true });
    window.addEventListener("resize", updateScrollState);
    return () => {
      node.removeEventListener("scroll", updateScrollState);
      window.removeEventListener("resize", updateScrollState);
    };
  }, [similarArtists, similarArtistsScrollRef, updateScrollState]);

  if (!loadingSimilar && similarArtists.length === 0) return null;

  return (
    <div className="mt-12">
      <div className="mb-4 flex items-center justify-between gap-3">
        <h2
          className="flex items-center text-2xl font-bold"
          style={{ color: "#fff" }}
        >
          Similar Artists
          {loadingSimilar && (
            <Loader
              className="ml-2 h-4 w-4 animate-spin"
              style={{ color: "#c1c1c3" }}
            />
          )}
        </h2>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => scrollByAmount(-1)}
            className="flex h-10 w-10 items-center justify-center transition-colors disabled:cursor-default"
            style={{ color: canScrollLeft ? "#6f7685" : "#2d3442" }}
            aria-label="Scroll similar artists left"
            disabled={!canScrollLeft}
          >
            <ChevronLeft className="h-7 w-7 stroke-[1.5]" />
          </button>
          <button
            type="button"
            onClick={() => scrollByAmount(1)}
            className="flex h-10 w-10 items-center justify-center transition-colors disabled:cursor-default"
            style={{ color: canScrollRight ? "#d1d5df" : "#2d3442" }}
            aria-label="Scroll similar artists right"
            disabled={!canScrollRight}
          >
            <ChevronRight className="h-7 w-7 stroke-[1.5]" />
          </button>
        </div>
      </div>
      {loadingSimilar ? (
        <div className="flex items-center justify-center py-12">
          <Loader
            className="w-8 h-8 animate-spin"
            style={{ color: "#c1c1c3" }}
          />
        </div>
      ) : similarArtists.length > 0 ? (
        <div>
          <div
            ref={similarArtistsScrollRef}
            className="flex overflow-x-auto pb-4 gap-4 scroll-smooth similar-artists-scroll flex-1"
            style={{
              scrollbarWidth: "none",
              msOverflowStyle: "none",
            }}
          >
            {similarArtists.map((similar) => {
              const artistId = getArtistId(similar);
              return (
                <div
                  key={similar.id}
                  className="group w-[148px] shrink-0 cursor-pointer sm:w-[164px]"
                  onClick={() => onArtistClick(similar.id, similar.name)}
                >
                  <div
                    className="relative aspect-square overflow-hidden  mb-2 shadow-sm group-hover:shadow-md transition-all"
                    style={{ backgroundColor: "#211f27" }}
                  >
                    <ArtistImage
                      src={similar.image}
                      mbid={similar.id}
                      artistName={similar.name}
                      alt={similar.name}
                      className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                    />

                    <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"></div>

                    {similar.match && (
                      <div className="absolute bottom-2 left-2 bg-black/60 backdrop-blur-sm text-white text-[10px] px-1.5 py-0.5 font-medium">
                        {similar.match}% Match
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2 min-w-0">
                    <h3
                      className="font-medium text-sm truncate transition-colors min-w-0"
                      style={{ color: "#fff" }}
                    >
                      {similar.name}
                    </h3>
                    {artistId && libraryLookup[artistId] && (
                      <CheckCircle2 className="w-4 h-4 text-green-400 shrink-0" />
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

ArtistDetailsSimilar.propTypes = {
  loadingSimilar: PropTypes.bool,
  similarArtists: PropTypes.arrayOf(
    PropTypes.shape({
      id: PropTypes.string,
      name: PropTypes.string,
      image: PropTypes.string,
      match: PropTypes.number,
    })
  ),
  similarArtistsScrollRef: PropTypes.oneOfType([
    PropTypes.func,
    PropTypes.shape({ current: PropTypes.instanceOf(Element) }),
  ]),
  onArtistClick: PropTypes.func,
};
