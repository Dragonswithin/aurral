# Flows and Playlists

This page explains how Aurral builds flows, how imported playlists differ, and what each control actually does.

## The difference

- **Flows** are dynamic playlists. They regenerate on their schedule and can change over time.
- **Playlists** are static tracklists. They come from imported JSON or exported flow tracklists and do not regenerate.
- Both use the same download worker.
- Flows can generate replacement picks when needed.
- Imported playlists keep retrying the exact tracks they were given.

## How a flow works

Think of a flow as three layers:

1. **Schedule**
2. **Source Mix**
3. **Focus Inputs**

The flow first decides **when** to run, then **where tracks should come from**, then **what the dedicated Focus source should try to match**.

## Schedule

- **Tracks** sets the playlist size.
- **Update Days** chooses which days the flow may run.
- **Update Hour** chooses the hour for those runs.
- A flow only starts generating when it is enabled.
- A disabled flow is a draft. Its settings are saved, but it will not run until enabled.

## Source Mix

Source Mix controls where tracks come from.

- **Discover** uses Aurral's recommendation/discovery pool and always excludes library artists.
- **Library** uses artists from your own library and is the only source allowed to do that.
- **Trending** uses trending artists from the broader cache and always excludes library artists.
- **Focus** uses non-library artists that best match your genre tags and related artists.

The mix slider is still one shared slider:

- With all 4 sources on, it behaves like a 4-way mix.
- With 2 sources on, it collapses into a 2-way split.
- With 1 source on, that source takes 100%.

The counts shown inside the slider are the current track targets for each source based on the flow size.

### Source toggles

- Turning a source **off** removes it from the mix entirely.
- Turning a source **on** adds it back into the shared slider.

### Important Library behavior

- **Library** is the only source allowed to use library artists.
- **Discover**, **Trending**, and **Focus** always exclude library artists.
- Turning **Library** off does not disable your saved focus inputs. It only removes the library-only source from the mix.

## Deep Dive

Deep Dive changes how far Aurral looks when pulling candidates for a source.

- **Off** keeps the source pulls narrower.
- **On** lets Aurral reach further and pull from a broader slice of each source.

It does not change the schedule or source percentages. It changes the breadth of candidate selection inside the active sources.

## Focus

Focus is a dedicated fourth source. It does not bend Discover, Library, or Trending.

- **Genre Tags** tell Focus which genres to target.
- **Related Artists** tell Focus which similarity seeds to target.
- If **Focus** is enabled in Source Mix, at least one genre tag or related artist is required.
- If **Focus** is disabled, your tags and related artists can stay saved, but they are inactive.

### Focus matching behavior

When both Genre Tags and Related Artists are present, Focus broadens in this order:

1. Artists related to all entered related artists and matching all tags
2. Artists related to all entered related artists and matching at least one tag
3. Artists related to any entered related artist and matching all tags
4. Artists related to any entered related artist and matching at least one tag
5. Artists related to all entered related artists only
6. Artists related to any entered related artist only
7. Tag-only artists matching all tags
8. Tag-only artists matching at least one tag

### Multiple tags or multiple related artists

- Multiple tags prefer overlap first. `acoustic, sad` tries to find artists matching both before broadening to one-tag matches.
- Multiple related artists prefer shared similarity first. If you enter two seeds, Focus first prefers artists similar to both before broadening to artists similar to only one.

## Fallback behavior

Aurral always tries the most specific matches first, then relaxes if it runs out of valid candidates.

The general order is:

1. Fill each enabled source with its own quota
2. For Focus, match the focus request as closely as possible before broadening
3. Keep strict one-song-per-artist diversity across the whole run
4. Redistribute source shortfalls across the other enabled sources
5. Use reserve/replacement candidates if the run still comes up short

That means:

- Focus does not secretly steer the other sources
- users can make highly targeted playlists by weighting Focus heavily or using Focus alone
- the fallback still stays inside the enabled sources whenever possible

## Focus input behavior

- Enter multiple tags or artists separated by commas.
- Entries tokenize when separated by a comma or when the field loses focus.
- Duplicate entries are ignored when they become tokens.

## Flow generation behavior

When a flow runs, Aurral:

1. Calculates the track count target.
2. Calculates source counts from the current Source Mix.
3. Harvests oversized candidate pools inside each enabled source.
4. Builds a dedicated Focus pool if Focus is enabled.
5. Picks the primary playlist with a strict one-song-per-artist rule.
6. Redistributes any source shortfalls across the other enabled sources.
7. Builds a reserve pool from the same run for fast replacements.
8. Sends the primary playlist into the download worker.

## Imported playlists

Imported playlists are separate from flows.

- They do not regenerate on a schedule.
- They do not use Source Mix, Focus Filters, or Deep Dive.
- They retry the exact tracklist they were imported with.
- They can reuse completed Aurral tracks or existing Lidarr files when Worker Settings -> Existing Files is set to Hardlink or Copy.

## Existing file reuse

Aurral keeps every generated playlist entry inside its own playlist folder under `aurral-weekly-flow/<playlist-id>`. When existing file reuse is enabled, that entry can be a hardlink or copy instead of a new Soulseek download.

- `Download` always downloads a new file.
- `Hardlink` tries to hardlink a matching completed Aurral or Lidarr file, then falls back to copying.
- `Copy` copies matching completed Aurral or Lidarr files into the generated playlist library.

Aurral-global reuse prevents the same imported track from being downloaded again for another playlist. Lidarr-aware reuse requires Aurral to see Lidarr's root directory the same way Lidarr sees it. In Lidarr, find this at `Settings -> Media Management -> Root Folders -> Path`. If your Lidarr root folder is `/data`, mount that same host library path into Aurral as `/data`:

```yaml
aurral:
  volumes:
    - /srv/aurral/downloads:/app/downloads
    - /srv/music:/data:ro
```

## What the importer accepts

The importer accepts these JSON shapes:

1. An exported Aurral playlist file
2. A single playlist object with a `tracks` array
3. A raw array of tracks
4. A bundle object with a `playlists` array
5. A nested `{ "playlist": { ... } }` wrapper

## Required track fields

Each track must include:

- `artistName`
- `trackName`

Accepted aliases:

- artist: `artistName`, `artist`, `artist_name`, `Artist Name(s)`
- track: `trackName`, `title`, `name`, `track`, `Track Name`
- album: `albumName`, `album`, `Album Name`
- artist id: `artistMbid`, `artistId`, `mbid`

## Spotify playlist import

You can import Spotify playlists with a CSV-to-JSON bridge:

1. Export the playlist from [Exportify](https://exportify.net/)
2. Convert the CSV to JSON with [CSVJSON](https://csvjson.com/csv2json)
3. Import that JSON file in Aurral

Aurral accepts CSVJSON output directly as one playlist and understands Spotify-style keys like `Track Name`, `Artist Name(s)`, and `Album Name`.

## Accepted JSON examples

### 1. Exported Aurral playlist file

```json
{
  "type": "aurral-static-tracklist",
  "version": 1,
  "exportedAt": "2026-03-25T12:00:00.000Z",
  "name": "Late Night Finds",
  "sourceName": "Friday Flow",
  "sourceFlowId": "abc123",
  "trackCount": 2,
  "tracks": [
    {
      "artistName": "Burial",
      "trackName": "Archangel",
      "albumName": "Untrue",
      "artistMbid": null
    },
    {
      "artistName": "Four Tet",
      "trackName": "Two Thousand and Seventeen",
      "albumName": null,
      "artistMbid": null
    }
  ]
}
```

### 2. Single playlist object

```json
{
  "name": "My Playlist",
  "tracks": [
    { "artistName": "Massive Attack", "trackName": "Teardrop" },
    { "artistName": "Portishead", "trackName": "Roads" }
  ]
}
```

### 3. Raw array of tracks

```json
[
  { "artistName": "Burial", "trackName": "Archangel" },
  { "artistName": "Air", "trackName": "La Femme d'Argent" }
]
```

### 4. Multi-playlist bundle

```json
{
  "playlists": [
    {
      "name": "Warm",
      "tracks": [{ "artistName": "Bonobo", "trackName": "Kiara" }]
    },
    {
      "name": "Dark",
      "tracks": [{ "artistName": "Burial", "trackName": "Near Dark" }]
    }
  ]
}
```

### 5. Nested playlist wrapper

```json
{
  "playlist": {
    "name": "Imported Set",
    "tracks": [{ "artistName": "Air", "trackName": "La Femme d'Argent" }]
  }
}
```

## Import and retry notes

- A top-level array of track objects is treated as one playlist.
- A top-level array of playlist objects is treated as multiple playlists.
- If an imported playlist name conflicts with an existing playlist, Aurral renames it automatically.
- Imported playlists queue their own downloads and do not affect any flow configuration.
- When existing file reuse succeeds, the imported track is marked complete immediately and is not queued for download.

### Download retries and failure behavior

- Each imported track is queued as its own worker job.
- Retryable failures get an immediate retry with backoff.
- Known non-retryable errors are skipped for immediate retry.
- If a playlist is incomplete and has no pending/downloading jobs, failed tracks are requeued in the periodic incomplete-playlist cycle.
- Imported playlists keep retrying the same original tracklist.
- Only flows may generate replacement tracks.
