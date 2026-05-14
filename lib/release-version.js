const RELEASE_TAG_RE =
  /^v?(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?:-test\.(?<prerelease>\d+))?$/i;

export const DEFAULT_INITIAL_STABLE_VERSION = "1.0.0";

export function normalizeReleaseVersion(value) {
  return String(value || "").trim().replace(/^v/, "");
}

export function parseReleaseVersion(value) {
  const normalized = normalizeReleaseVersion(value);
  const match = RELEASE_TAG_RE.exec(normalized);
  if (!match?.groups) {
    return null;
  }

  const major = Number(match.groups.major);
  const minor = Number(match.groups.minor);
  const patch = Number(match.groups.patch);
  const prerelease =
    match.groups.prerelease == null ? null : Number(match.groups.prerelease);

  return {
    raw: String(value || ""),
    label: normalized,
    major,
    minor,
    patch,
    prerelease,
    channel: prerelease == null ? "stable" : "test",
  };
}

export function compareReleaseVersions(left, right) {
  const a = typeof left === "string" ? parseReleaseVersion(left) : left;
  const b = typeof right === "string" ? parseReleaseVersion(right) : right;

  if (!a || !b) {
    return 0;
  }
  if (a.major !== b.major) {
    return a.major - b.major;
  }
  if (a.minor !== b.minor) {
    return a.minor - b.minor;
  }
  if (a.patch !== b.patch) {
    return a.patch - b.patch;
  }
  if (a.prerelease == null && b.prerelease == null) {
    return 0;
  }
  if (a.prerelease == null) {
    return 1;
  }
  if (b.prerelease == null) {
    return -1;
  }
  return a.prerelease - b.prerelease;
}

export function extractTagNameFromRef(ref) {
  const match = String(ref || "").match(/^refs\/tags\/(.+)$/);
  return match ? match[1] : "";
}

export function selectLatestReleaseForChannel(refs, channel) {
  const expectedChannel = channel === "test" ? "test" : "stable";
  const candidates = (Array.isArray(refs) ? refs : [])
    .map((ref) => {
      const tagName =
        typeof ref === "string"
          ? ref
          : ref?.tag_name || ref?.name || extractTagNameFromRef(ref?.ref);
      const parsed = parseReleaseVersion(tagName);
      return parsed ? { parsed, tagName: `v${parsed.label}` } : null;
    })
    .filter(
      (candidate) => candidate && candidate.parsed.channel === expectedChannel,
    );

  if (!candidates.length) {
    return null;
  }

  candidates.sort((left, right) =>
    compareReleaseVersions(right.parsed, left.parsed),
  );

  return candidates[0];
}

function toTagName(version) {
  return `v${normalizeReleaseVersion(version)}`;
}

function getStableReleases(tags) {
  return (Array.isArray(tags) ? tags : [])
    .map((tag) => parseReleaseVersion(tag))
    .filter((release) => release && release.channel === "stable")
    .sort((left, right) => compareReleaseVersions(right, left));
}

function getHeadTagForBranch(tags, branch) {
  const expected =
    branch === "test"
      ? (release) => release.channel === "test"
      : (release) => release.channel === "stable";
  return (Array.isArray(tags) ? tags : [])
    .map((tag) => parseReleaseVersion(tag))
    .find((release) => release && expected(release));
}

function incrementStablePatch(release) {
  return {
    major: release.major,
    minor: release.minor,
    patch: release.patch + 1,
    prerelease: null,
    channel: "stable",
    label: `${release.major}.${release.minor}.${release.patch + 1}`,
  };
}

export function formatRelease(release) {
  if (!release) {
    return "";
  }
  if (release.channel === "test") {
    return `${release.major}.${release.minor}.${release.patch}-test.${release.prerelease}`;
  }
  return `${release.major}.${release.minor}.${release.patch}`;
}

export function resolveNextRelease({
  branch,
  allTags = [],
  headTags = [],
  initialStableVersion = DEFAULT_INITIAL_STABLE_VERSION,
} = {}) {
  if (branch !== "main" && branch !== "test") {
    return null;
  }

  const existingHeadRelease = getHeadTagForBranch(headTags, branch);
  if (existingHeadRelease) {
    const version = formatRelease(existingHeadRelease);
    return {
      tag: toTagName(version),
      version,
      channel: existingHeadRelease.channel,
      isPrerelease: existingHeadRelease.channel === "test",
      makeLatest: existingHeadRelease.channel === "stable",
      reusedExistingTag: true,
    };
  }

  const stableReleases = getStableReleases(allTags);
  const latestStable =
    stableReleases[0] || parseReleaseVersion(initialStableVersion);

  if (!latestStable) {
    throw new Error(
      `Unable to resolve initial stable version from "${initialStableVersion}".`,
    );
  }

  if (branch === "main") {
    const nextStable = incrementStablePatch(latestStable);
    const version = formatRelease(nextStable);
    return {
      tag: toTagName(version),
      version,
      channel: "stable",
      isPrerelease: false,
      makeLatest: true,
      reusedExistingTag: false,
    };
  }

  const nextStable = incrementStablePatch(latestStable);
  const prereleaseBase = formatRelease(nextStable);
  const existingPrereleases = (Array.isArray(allTags) ? allTags : [])
    .map((tag) => parseReleaseVersion(tag))
    .filter(
      (release) =>
        release &&
        release.channel === "test" &&
        release.major === nextStable.major &&
        release.minor === nextStable.minor &&
        release.patch === nextStable.patch,
    )
    .sort((left, right) => compareReleaseVersions(right, left));

  const nextPrereleaseNumber =
    existingPrereleases[0]?.prerelease != null
      ? existingPrereleases[0].prerelease + 1
      : 1;
  const version = `${prereleaseBase}-test.${nextPrereleaseNumber}`;
  return {
    tag: toTagName(version),
    version,
    channel: "test",
    isPrerelease: true,
    makeLatest: false,
    reusedExistingTag: false,
  };
}
