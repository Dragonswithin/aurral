import { useState, useEffect, useRef } from "react";
import {
  getArtistDetails,
  getArtistCover,
  lookupArtistInLibrary,
  getLibraryAlbums,
  getLibraryArtist,
  getSimilarArtistsForArtist,
  getAppSettings,
  getReleaseGroupCover,
  getStoredAuth,
} from "../../../utils/api";
import { emptyArtistShape } from "../constants";
import { matchesReleaseTypeFilter } from "../utils";

const buildInitialArtist = (mbid, artistNameFromNav) =>
  mbid
    ? {
        id: mbid,
        name: artistNameFromNav || "Loading artist",
        "sort-name": artistNameFromNav || "Loading artist",
        ...emptyArtistShape,
        "release-groups": [],
      }
    : null;

export function useArtistDetailsStream(
  mbid,
  artistNameFromNav,
  selectedReleaseTypes = [],
  { visibleCoverIds = [] } = {},
) {
  const initialArtist = buildInitialArtist(mbid, artistNameFromNav);

  const [artist, setArtist] = useState(initialArtist);
  const [coverImages, setCoverImages] = useState([]);
  const [libraryArtist, setLibraryArtist] = useState(null);
  const [libraryAlbums, setLibraryAlbums] = useState([]);
  const [similarArtists, setSimilarArtists] = useState([]);
  const [loading, setLoading] = useState(!mbid);
  const [error, setError] = useState(null);
  const [existsInLibrary, setExistsInLibrary] = useState(false);
  const [loadingCover, setLoadingCover] = useState(true);
  const [loadingSimilar, setLoadingSimilar] = useState(true);
  const [loadingLibrary, setLoadingLibrary] = useState(true);
  const [appSettings, setAppSettings] = useState(null);
  const [albumCovers, setAlbumCovers] = useState({});
  const requestedAlbumCoversRef = useRef(new Set());
  const artistMbidRef = useRef(mbid);
  const artistNameRef = useRef(artistNameFromNav || "");

  if (artistMbidRef.current !== mbid) {
    artistMbidRef.current = mbid;
    requestedAlbumCoversRef.current = new Set();
  }

  useEffect(() => {
    if (artistNameFromNav) artistNameRef.current = artistNameFromNav;
  }, [artistNameFromNav]);

  useEffect(() => {
    if (artist?.name) artistNameRef.current = artist.name;
  }, [artist?.name]);

  useEffect(() => {
    if (!mbid) return;
    setArtist(buildInitialArtist(mbid, artistNameFromNav));
    setCoverImages([]);
    setAlbumCovers({});
    setSimilarArtists([]);
    setLoading(!mbid);
    setError(null);
    setLoadingCover(true);
    setLoadingSimilar(true);
    setLibraryArtist(null);
    setLibraryAlbums([]);
    setExistsInLibrary(false);
    setLoadingLibrary(true);

    getAppSettings()
      .then(setAppSettings)
      .catch(() => {});

    const API_BASE_URL = import.meta.env.VITE_API_URL || "/api";
    const { token } = getStoredAuth();

    let streamUrl = `${API_BASE_URL}/artists/${mbid}/stream`;
    const streamParams = [];
    if (token) {
      streamParams.push(`token=${encodeURIComponent(token)}`);
    }
    if (artistNameFromNav) {
      streamParams.push(`artistName=${encodeURIComponent(artistNameFromNav)}`);
    }
    if (streamParams.length) streamUrl += `?${streamParams.join("&")}`;

    const eventSource = new EventSource(streamUrl);
    let artistReceived = false;
    let streamComplete = false;
    let coverReceived = false;
    let similarReceived = false;
    let libraryReceived = false;
    let restFallbackStarted = false;

    const loadCoverAndSimilarFallback = async (nameForCover, refreshCover = false) => {
      const requests = [];
      if (!coverReceived) {
        requests.push(
          getArtistCover(mbid, nameForCover, refreshCover)
            .then((coverData) => {
              if (coverData.images && coverData.images.length > 0) {
                setCoverImages(coverData.images);
              }
            })
            .catch(() => {})
            .finally(() => setLoadingCover(false)),
        );
      }
      if (!similarReceived) {
        requests.push(
          getSimilarArtistsForArtist(mbid, nameForCover || "")
            .then((similarData) => {
              setSimilarArtists(similarData.artists || []);
            })
            .catch(() => {})
            .finally(() => setLoadingSimilar(false)),
        );
      }
      await Promise.allSettled(requests);
    };

    const loadLibraryFallback = async () => {
      setLoadingLibrary(true);
      try {
        const lookup = await lookupArtistInLibrary(mbid);
        setExistsInLibrary(lookup.exists);
        if (!lookup.exists || !lookup.artist) return;

        const fullArtist = await getLibraryArtist(
          lookup.artist.mbid || lookup.artist.foreignArtistId,
        ).catch((err) => {
          console.error("Failed to fetch full artist details:", err);
          return lookup.artist;
        });

        setLibraryArtist(fullArtist);

        const artistId = fullArtist.id || lookup.artist.id;
        if (!artistId) return;

        const albums = await getLibraryAlbums(artistId).catch((err) => {
          console.error("Failed to fetch library albums:", err);
          return [];
        });
        setLibraryAlbums(albums);
      } catch {}
      finally {
        setLoadingLibrary(false);
      }
    };

    const loadRestFallback = async () => {
      if (restFallbackStarted) return;
      restFallbackStarted = true;
      clearTimeout(fallbackTimeout);
      eventSource.close();

      try {
        const artistData = await getArtistDetails(mbid, artistNameFromNav, {
          mode: "core",
        });
        if (!artistData || !artistData.id) {
          throw new Error("Invalid artist data received");
        }
        setArtist(artistData);
        setLoading(false);

        const nameForCover = artistData?.name || artistNameRef.current || artistNameFromNav || "";
        artistNameRef.current = nameForCover;
        await Promise.allSettled([
          loadCoverAndSimilarFallback(nameForCover),
          libraryReceived ? Promise.resolve() : loadLibraryFallback(),
        ]);
      } catch (err) {
        console.error("Error fetching artist data:", err);
        setError(
          err.response?.data?.message ||
            err.response?.data?.error ||
            err.message ||
            "Failed to fetch artist details",
        );
        setLoading(false);
        setLoadingCover(false);
        setLoadingSimilar(false);
        setLoadingLibrary(false);
      }
    };

    const fallbackTimeout = setTimeout(() => {
      const nameForCover = artistNameRef.current || artistNameFromNav || "";
      loadCoverAndSimilarFallback(nameForCover).catch(() => {});
    }, 2500);

    eventSource.addEventListener("connected", () => {});

    eventSource.addEventListener("artist", (event) => {
      try {
        const artistData = JSON.parse(event.data);
        if (!artistData || !artistData.id) {
          throw new Error("Invalid artist data received");
        }
        setArtist((prev) => {
          if (!prev) return artistData;
          const next = { ...prev, ...artistData };
          if (!("release-groups" in artistData)) {
            next["release-groups"] = prev["release-groups"];
          }
          if (!("release-group-count" in artistData)) {
            next["release-group-count"] = prev["release-group-count"];
          }
          if (!("release-count" in artistData)) {
            next["release-count"] = prev["release-count"];
          }
          if (!("tags" in artistData)) next.tags = prev.tags;
          if (!("genres" in artistData)) next.genres = prev.genres;
          if (!("bio" in artistData)) next.bio = prev.bio;
          return next;
        });
        if (!artistReceived) setLoading(false);
        artistReceived = true;
      } catch (err) {
        console.error("Error parsing artist data:", err);
        setError("Failed to parse artist data");
        setLoading(false);
      }
    });

    eventSource.addEventListener("cover", (event) => {
      try {
        const coverData = JSON.parse(event.data);
        coverReceived = true;
        if (coverData.images && coverData.images.length > 0) {
          setCoverImages(coverData.images);
        }
        setLoadingCover(false);
      } catch (err) {
        console.error("Error parsing cover data:", err, event.data);
        setLoadingCover(false);
      }
    });

    eventSource.addEventListener("similar", (event) => {
      try {
        const similarData = JSON.parse(event.data);
        similarReceived = true;
        setSimilarArtists(similarData.artists || []);
        setLoadingSimilar(false);
      } catch (err) {
        console.error("Error parsing similar artists data:", err, event.data);
        setLoadingSimilar(false);
      }
    });

    eventSource.addEventListener("library", (event) => {
      try {
        const data = JSON.parse(event.data);
        libraryReceived = true;
        if (data.exists && data.artist) {
          setExistsInLibrary(true);
          setLibraryArtist(data.artist);
          setLibraryAlbums(data.albums || []);
        }
        setLoadingLibrary(false);
      } catch (err) {
        console.error("Error parsing library data:", err, event.data);
      }
    });

    eventSource.addEventListener("complete", () => {
      streamComplete = true;
      clearTimeout(fallbackTimeout);
      eventSource.close();

      if (libraryReceived) {
        return;
      }

      loadLibraryFallback().catch(() => {});
    });

    eventSource.addEventListener("error", (event) => {
      try {
        const errorData = JSON.parse(event.data);
        if (!artistReceived) {
          loadRestFallback().catch(() => {});
          return;
        }
        setError(
          errorData.message ||
            errorData.error ||
            "Failed to fetch artist details",
        );
        setLoading(false);
        eventSource.close();
      } catch {
        if (eventSource.readyState === EventSource.CLOSED) {
          loadRestFallback().catch(() => {});
        }
      }
    });

    eventSource.onerror = () => {
      if (!artistReceived && !streamComplete) {
        loadRestFallback().catch(() => {});
      }
    };

    return () => {
      clearTimeout(fallbackTimeout);
      eventSource.close();
    };
  }, [mbid, artistNameFromNav]);

  useEffect(() => {
    if (!mbid) return;

    const releaseGroupIds =
      artist?.["release-groups"]
        ?.filter((rg) => matchesReleaseTypeFilter(rg, selectedReleaseTypes))
        .map((rg) => rg.id)
        .filter(Boolean) || [];
    const libraryMbids = (libraryAlbums || [])
      .map((album) => album.mbid || album.foreignAlbumId)
      .filter(Boolean);
    const needed = [...new Set([...releaseGroupIds, ...libraryMbids])];
    if (!needed.length) return;

    const prioritized = visibleCoverIds.length
      ? visibleCoverIds.filter((id) => needed.includes(id))
      : needed.slice(0, 8);
    const missing = prioritized.filter(
      (id) => !albumCovers[id] && !requestedAlbumCoversRef.current.has(id),
    );
    if (!missing.length) return;

    let cancelled = false;

    const run = async () => {
      const BATCH_SIZE = 6;
      for (let i = 0; i < missing.length; i += BATCH_SIZE) {
        if (cancelled) return;
        const batch = missing.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.allSettled(
          batch.map(async (rgId) => {
            requestedAlbumCoversRef.current.add(rgId);
            try {
              const releaseGroup = artist?.["release-groups"]?.find(
                (item) => item?.id === rgId,
              );
              const data = await getReleaseGroupCover(rgId, {
                artistName: artistNameRef.current || artist?.name || "",
                albumTitle:
                  releaseGroup?.title ||
                  libraryAlbums?.find(
                    (album) => (album.mbid || album.foreignAlbumId) === rgId,
                  )?.albumName ||
                  "",
              });
              if (cancelled || !data?.images?.length) return;
              const front =
                data.images.find((img) => img.front) || data.images[0];
              const url = front?.image;
              if (url) {
                return [rgId, url];
              }
            } catch {
            } finally {
              requestedAlbumCoversRef.current.delete(rgId);
            }
            return null;
          }),
        );
        if (cancelled) return;
        const nextBatch = Object.fromEntries(
          batchResults.filter(
            (entry) => Array.isArray(entry.value) && entry.value[0] && entry.value[1],
          ).map((entry) => entry.value),
        );
        if (Object.keys(nextBatch).length > 0) {
          setAlbumCovers((prev) => ({ ...prev, ...nextBatch }));
        }
      }
    };

    const timer = setTimeout(run, 50);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [
    mbid,
    artist,
    libraryAlbums,
    albumCovers,
    selectedReleaseTypes,
    visibleCoverIds,
  ]);

  return {
    artist,
    setArtist,
    coverImages,
    setCoverImages,
    libraryArtist,
    setLibraryArtist,
    libraryAlbums,
    setLibraryAlbums,
    similarArtists,
    setSimilarArtists,
    loading,
    error,
    setError,
    loadingCover,
    setLoadingCover,
    loadingSimilar,
    setLoadingSimilar,
    loadingLibrary,
    setLoadingLibrary,
    existsInLibrary,
    setExistsInLibrary,
    appSettings,
    albumCovers,
    setAlbumCovers,
  };
}
