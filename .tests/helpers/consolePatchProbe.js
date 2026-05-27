process.argv[1] = new URL("../../backend/server.js", import.meta.url).pathname;

await import("../../backend/loadEnv.js");

console.log("Discovery cache needs update. Starting...");
console.log("Server running on port 3001");
console.debug("debug detail");
console.error("Unhandled Rejection:", new Error("probe failure"));
