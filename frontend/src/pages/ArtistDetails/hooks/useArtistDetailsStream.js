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

export function useArtistDetailsStream(
  mbid,
  artistNameFromNav,
  selectedReleaseTypes = [],
) {
  const initialArtist =
    mbid && artistNameFromNav
      ? {
          id: mbid,
          name: artistNameFromNav,
          "sort-name": artistNameFromNav,
          ...emptyArtistShape,
          "release-groups": [],
        }
      : null;

  const [artist, setArtist] = useState(initialArtist);
  const [coverImages, setCoverImages] = useState([]);
  const [libraryArtist, setLibraryArtist] = useState(null);
  const [libraryAlbums, setLibraryAlbums] = useState([]);
  const [similarArtists, setSimilarArtists] = useState([]);
  const [loading, setLoading] = useState(!initialArtist);
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
    setLoading(!(mbid && artistNameFromNav));
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

    const fallbackTimeout = setTimeout(() => {
      if (!coverReceived) {
        const nameForCover = artistNameRef.current || artistNameFromNav;
        getArtistCover(mbid, nameForCover)
          .then((coverData) => {
            if (coverData.images && coverData.images.length > 0) {
              setCoverImages(coverData.images);
            }
          })
          .catch(() => {})
          .finally(() => setLoadingCover(false));
      }
      if (!similarReceived) {
        getSimilarArtistsForArtist(
          mbid,
          artistNameRef.current || artistNameFromNav || "",
        )
          .then((similarData) => {
            setSimilarArtists(similarData.artists || []);
          })
          .catch(() => {})
          .finally(() => setLoadingSimilar(false));
      }
    }, 10000);

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

      setLoadingLibrary(true);
      lookupArtistInLibrary(mbid)
        .then((lookup) => {
          setExistsInLibrary(lookup.exists);
          if (lookup.exists && lookup.artist) {
            return Promise.all([
              getLibraryArtist(
                lookup.artist.mbid || lookup.artist.foreignArtistId,
              ).catch((err) => {
                console.error("Failed to fetch full artist details:", err);
                return lookup.artist;
              }),
            ]).then(([fullArtist]) => {
              setLibraryArtist(fullArtist);
              return fullArtist.id || lookup.artist.id;
            });
          }
          return null;
        })
        .then((artistId) => {
          if (artistId) {
            setTimeout(() => {
              getLibraryAlbums(artistId)
                .then((albums) => {
                  setLibraryAlbums(albums);
                })
                .catch(() => {
                  setTimeout(() => {
                    getLibraryAlbums(artistId)
                      .then((albums) => setLibraryAlbums(albums))
                      .catch(() => {});
                  }, 2000);
                });
            }, 1000);
          }
        })
        .catch(() => {})
        .finally(() => setLoadingLibrary(false));
    });

    eventSource.addEventListener("error", (event) => {
      try {
        const errorData = JSON.parse(event.data);
        setError(
          errorData.message ||
            errorData.error ||
            "Failed to fetch artist details",
        );
        setLoading(false);
        eventSource.close();
      } catch {
        if (eventSource.readyState === EventSource.CLOSED) {
          eventSource.close();

          getArtistDetails(mbid, artistNameFromNav)
            .then((artistData) => {
              if (!artistData || !artistData.id) {
                throw new Error("Invalid artist data received");
              }
              setArtist(artistData);
              setLoading(false);

              const nameForCover = artistNameFromNav || artistData?.name;
              getArtistCover(mbid, nameForCover)
                .then((coverData) => {
                  if (coverData.images && coverData.images.length > 0) {
                    setCoverImages(coverData.images);
                  }
                })
                .catch(() => {})
                .finally(() => setLoadingCover(false));

              getSimilarArtistsForArtist(
                mbid,
                artistData?.name || artistNameFromNav || "",
              )
                .then((similarData) => {
                  setSimilarArtists(similarData.artists || []);
                })
                .catch(() => {})
                .finally(() => setLoadingSimilar(false));
            })
            .catch((err) => {
              console.error("Error fetching artist data:", err);
              setError(
                err.response?.data?.message ||
                  err.response?.data?.error ||
                  err.message ||
                  "Failed to fetch artist details",
              );
              setLoading(false);
            });
        }
      }
    });

    eventSource.onerror = () => {
      if (!artistReceived && !streamComplete) {
        eventSource.close();

        getArtistDetails(mbid, artistNameFromNav)
          .then((artistData) => {
            if (!artistData || !artistData.id) {
              throw new Error("Invalid artist data received");
            }
            setArtist(artistData);
            setLoading(false);

            const nameForCover = artistNameFromNav || artistData?.name;
            getArtistCover(mbid, nameForCover)
              .then((coverData) => {
                if (coverData.images && coverData.images.length > 0) {
                  setCoverImages(coverData.images);
                }
              })
              .catch(() => {})
              .finally(() => setLoadingCover(false));

            getSimilarArtistsForArtist(
              mbid,
              artistData?.name || artistNameFromNav || "",
            )
              .then((similarData) => {
                setSimilarArtists(similarData.artists || []);
              })
              .catch(() => {})
              .finally(() => setLoadingSimilar(false));
          })
          .catch((err) => {
            console.error("Error fetching artist data:", err);
            setError(
              err.response?.data?.message ||
                err.response?.data?.error ||
                err.message ||
                "Failed to fetch artist details",
            );
            setLoading(false);
          });
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

    const prioritized = needed.slice(0, 24);
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
        await Promise.allSettled(
          batch.map(async (rgId) => {
            requestedAlbumCoversRef.current.add(rgId);
            try {
              const data = await getReleaseGroupCover(rgId);
              if (cancelled || !data?.images?.length) return;
              const front =
                data.images.find((img) => img.front) || data.images[0];
              const url = front?.image;
              if (url) {
                setAlbumCovers((prev) => ({ ...prev, [rgId]: url }));
              }
            } catch {
            } finally {
              requestedAlbumCoversRef.current.delete(rgId);
            }
          }),
        );
      }
    };

    const timer = setTimeout(run, 50);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [mbid, artist, libraryAlbums, albumCovers, selectedReleaseTypes]);

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
