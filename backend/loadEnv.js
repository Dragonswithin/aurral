import dotenv from "dotenv";
import { basename, dirname, join } from "path";
import { fileURLToPath } from "url";

const TRUE_ENV_VALUES = new Set(["1", "true", "yes", "on", "verbose", "debug"]);
const DEFAULT_VISIBLE_MESSAGES = [
  /^Server running on port \d+/,
  /^Port \d+ is already in use\./,
  /^Frontend not built\./,
  /^Uncaught Exception:/,
  /^Unhandled Rejection:/,
  /^Server error:/,
];

export const isVerboseConsoleEnabled = (env = process.env) =>
  TRUE_ENV_VALUES.has(
    String(env.AURRAL_VERBOSE_LOGS || "").trim().toLowerCase(),
  );

const isServerProcess = (argv = process.argv) =>
  basename(argv[1] || "") === "server.js";

const formatLogTimestamp = () =>
  new Date().toISOString().replace("T", " ").slice(0, 19);

const hasTimestampPrefix = (value) =>
  typeof value === "string" &&
  /^\[\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}/.test(value);

const toCompactConsoleValue = (value) => {
  if (value == null) return "";
  if (value instanceof Error) return value.message || value.name;
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }
  return "";
};

export const shouldEmitDefaultConsoleMessage = (method, args = []) => {
  if (method === "debug") return false;
  if (method === "warn" || method === "error") return true;

  const first = args[0];
  if (typeof first !== "string") return false;
  return DEFAULT_VISIBLE_MESSAGES.some((pattern) => pattern.test(first));
};

const formatDefaultConsoleArgs = (args = []) => {
  const values = args.map(toCompactConsoleValue).filter(Boolean);
  if (values.length > 0) return [values.join(" ")];
  if (args.length > 0) {
    return ["Details hidden. Set AURRAL_VERBOSE_LOGS=true for full logs."];
  }
  return [""];
};

const patchConsoleWithTimestamp = () => {
  if (globalThis.__aurralConsoleTimestampPatched) return;
  globalThis.__aurralConsoleTimestampPatched = true;
  const verbose = isVerboseConsoleEnabled();
  const compactServerConsole = isServerProcess() && !verbose;

  for (const method of ["log", "info", "warn", "error", "debug"]) {
    const original = console[method].bind(console);
    console[method] = (...args) => {
      if (compactServerConsole && !shouldEmitDefaultConsoleMessage(method, args)) {
        return;
      }

      const visibleArgs = compactServerConsole
        ? formatDefaultConsoleArgs(args)
        : args;
      const timestamp = `[${formatLogTimestamp()}]`;
      if (visibleArgs.length === 0) {
        original(timestamp);
        return;
      }

      const [first, ...rest] = visibleArgs;
      if (typeof first === "string") {
        if (hasTimestampPrefix(first)) {
          original(first, ...rest);
          return;
        }
        original(`${timestamp} ${first}`, ...rest);
        return;
      }
      original(timestamp, first, ...rest);
    };
  }
};

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, ".env"), quiet: true });

patchConsoleWithTimestamp();
