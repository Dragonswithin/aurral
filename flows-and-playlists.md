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
3. **Focus Filters**

The flow first decides **when** to run, then **where artists should come from**, then **what those artists should try to match**.

## Schedule

- **Tracks** sets the playlist size.
- **Update Days** chooses which days the flow may run.
- **Update Hour** chooses the hour for those runs.
- A flow only starts generating when it is enabled.
- A disabled flow is a draft. Its settings are saved, but it will not run until enabled.

## Source Mix

Source Mix controls where the artists come from.

- **Discover** uses Aurral's recommendation/discovery pool.
- **Library** uses artists from your own library.
- **Trending** uses trending artists from the broader cache.

The mix slider is still one shared slider:

- With all 3 sources on, it behaves like a 3-way mix.
- With 2 sources on, it collapses into a 2-way split.
- With 1 source on, that source takes 100%.

The counts shown inside the slider are the current track targets for each source based on the flow size.

### Source toggles

- Turning a source **off** removes it from the mix entirely.
- Turning a source **on** adds it back into the shared slider.

### Important Library behavior

The **Library** toggle does more than hide the direct library bucket.

- If **Library is on**, library artists are allowed anywhere in the flow.
- If **Library is off**, Aurral excludes library artists entirely, including from:
  - Discover
  - Trending
  - Genre-tag matches
  - Related-artist matches

So `Library Off` means: do not use artists from my library anywhere in this flow.

## Deep Dive

Deep Dive changes how far Aurral looks when pulling candidates for a source.

- **Off** keeps the source pulls narrower.
- **On** lets Aurral reach further and pull from a broader slice of each source.

It does not change the schedule or source percentages. It changes the breadth of candidate selection inside the active sources.

## Focus Filters

Focus Filters tell Aurral what the playlist should try to match.

- **Genre Tags** aims the flow toward artists with those tags.
- **Related Artists** aims the flow toward artists similar to the artists you enter.

They do not allocate a fixed percentage of the playlist anymore.

Source Mix still decides where tracks come from. Focus Filters rerank candidates inside those enabled sources.

### Strength levels

- **Light** gives a slight preference to matching candidates.
- **Medium** gives a strong preference to matching candidates.
- **Heavy** tries to exhaust matching candidates before broadening to looser fits.

So if you set:

- `rock` to **Heavy**

Aurral will first try to fill each enabled source with the strongest `rock` matches it can find. If that source runs short, it broadens gradually inside the active sources instead of immediately behaving like an all-rock hard filter.

That means it will try to fill:

- the Discover share with rock-compatible discover artists
- the Library share with rock-compatible library artists
- the Trending share with rock-compatible trending artists

## When both Genre Tags and Related Artists are used

- Both groups contribute to the reranking score.
- Their selected strength controls how much influence each group has.
- If both are active, Aurral combines them instead of carving the playlist into separate tag and related-artist blocks.

Examples:

- `Genre Tags = Heavy`, `Related Artists = Off`:
  - tag matches are ranked first and broad source candidates are used only after the focused pool runs thin
- `Genre Tags = Heavy`, `Related Artists = Heavy`:
  - candidates that satisfy both signals rise to the top first
- `Genre Tags = Light`, `Related Artists = Heavy`:
  - related-artist fit has more influence than tag fit, but both still contribute

## Multiple tags or multiple related artists

When you enter multiple values, Aurral tries the overlap first.

### Multiple Genre Tags

If you enter:

- `indie, punk`

Aurral first prefers artists that match **both** tags before falling back to artists that match only one of them.

If there are still more tag-focused slots to fill after overlap candidates are used, it spreads the remaining target across the individual tags.

### Multiple Related Artists

If you enter multiple seed artists, Aurral first prefers artists that are similar to **more than one** of those seeds before falling back to per-seed matches.

## Fallback behavior

Aurral always tries the most specific matches first, then relaxes if it runs out of valid candidates.

The general order is:

1. Match the focus request as closely as possible
2. Keep the result aligned with the Source Mix
3. Broaden within the same source before giving up on that source
4. Redistribute shortfalls across the other enabled sources
5. Use reserve/replacement candidates if the run still comes up short

That means:

- `Heavy` does not mean “100% synthetic focus pool”
- it means “be strict first, broaden later”
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
4. Scores those candidates against your focus filters, taste context, and metadata confidence.
5. Picks the primary playlist with a strict one-song-per-artist rule.
6. Builds a reserve pool from the same run for fast replacements.
7. Sends the primary playlist into the download worker.

## Imported playlists

Imported playlists are separate from flows.

- They do not regenerate on a schedule.
- They do not use Source Mix, Focus Filters, or Deep Dive.
- They retry the exact tracklist they were imported with.

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

### Download retries and failure behavior

- Each imported track is queued as its own worker job.
- Retryable failures get an immediate retry with backoff.
- Known non-retryable errors are skipped for immediate retry.
- If a playlist is incomplete and has no pending/downloading jobs, failed tracks are requeued in the periodic incomplete-playlist cycle.
- Imported playlists keep retrying the same original tracklist.
- Only flows may generate replacement tracks.
