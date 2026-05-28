import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

import {
  isVerboseConsoleEnabled,
  shouldEmitDefaultConsoleMessage,
} from "../../backend/loadEnv.js";

const runConsoleProbe = (env = {}) => {
  const result = spawnSync("node", [".tests/helpers/consolePatchProbe.js"], {
    cwd: new URL("../..", import.meta.url),
    env: {
      ...process.env,
      AURRAL_VERBOSE_LOGS: "",
      ...env,
    },
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return `${result.stdout}${result.stderr}`;
};

test("verbose console mode accepts explicit truthy environment values", () => {
  assert.equal(isVerboseConsoleEnabled({ AURRAL_VERBOSE_LOGS: "true" }), true);
  assert.equal(isVerboseConsoleEnabled({ AURRAL_VERBOSE_LOGS: "1" }), true);
  assert.equal(isVerboseConsoleEnabled({ AURRAL_VERBOSE_LOGS: "debug" }), true);
});

test("verbose console mode stays off unless explicitly enabled", () => {
  assert.equal(isVerboseConsoleEnabled({}), false);
  assert.equal(isVerboseConsoleEnabled({ AURRAL_VERBOSE_LOGS: "false" }), false);
  assert.equal(isVerboseConsoleEnabled({ AURRAL_VERBOSE_LOGS: "0" }), false);
});

test("default server console keeps only important startup and problem output", () => {
  assert.equal(
    shouldEmitDefaultConsoleMessage("log", ["Server running on port 3001"]),
    true,
  );
  assert.equal(
    shouldEmitDefaultConsoleMessage("log", [
      "Discovery cache needs update. Starting...",
    ]),
    false,
  );
  assert.equal(
    shouldEmitDefaultConsoleMessage("warn", [
      "Failed to broadcast download statuses",
    ]),
    true,
  );
  assert.equal(
    shouldEmitDefaultConsoleMessage("error", [
      "Unhandled Rejection:",
      new Error("boom"),
    ]),
    true,
  );
  assert.equal(
    shouldEmitDefaultConsoleMessage("debug", ["Lidarr getArtistByMbid completed"]),
    false,
  );
});

test("patched default server console suppresses routine detail output", () => {
  const output = runConsoleProbe();

  assert.match(output, /Server running on port 3001/);
  assert.match(output, /Unhandled Rejection: probe failure/);
  assert.doesNotMatch(output, /Discovery cache needs update/);
  assert.doesNotMatch(output, /debug detail/);
});

test("patched verbose server console includes full detail output", () => {
  const output = runConsoleProbe({ AURRAL_VERBOSE_LOGS: "true" });

  assert.match(output, /Discovery cache needs update/);
  assert.match(output, /Server running on port 3001/);
  assert.match(output, /debug detail/);
  assert.match(output, /Unhandled Rejection:/);
  assert.match(output, /probe failure/);
});

test("structured logger starts at debug level in verbose console mode", async () => {
  const originalVerbose = process.env.AURRAL_VERBOSE_LOGS;
  process.env.AURRAL_VERBOSE_LOGS = "true";

  try {
    const { LOG_LEVELS_EXPORT, logger } = await import(
      `../../backend/services/logger.js?verbose-test=${Date.now()}`
    );
    assert.equal(logger.shouldLog(LOG_LEVELS_EXPORT.DEBUG), true);
  } finally {
    if (originalVerbose === undefined) {
      delete process.env.AURRAL_VERBOSE_LOGS;
    } else {
      process.env.AURRAL_VERBOSE_LOGS = originalVerbose;
    }
  }
});
