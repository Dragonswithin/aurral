export const allReleaseTypes = [
  "Album",
  "EP",
  "Single",
  "Broadcast",
  "Soundtrack",
  "Spokenword",
  "Remix",
  "Live",
  "Compilation",
  "Demo",
];

export const GRANULAR_PERMISSIONS = {
  accessFlow: false,
  addArtist: true,
  addAlbum: true,
  changeMonitoring: false,
  deleteArtist: false,
  deleteAlbum: false,
};

export const granularPerms = [
  { key: "accessFlow", label: "Access flows and playlists" },
  { key: "addArtist", label: "Add artist" },
  { key: "addAlbum", label: "Add album" },
  { key: "changeMonitoring", label: "Change artist monitoring" },
  { key: "deleteArtist", label: "Delete artists" },
  { key: "deleteAlbum", label: "Delete albums" },
];
