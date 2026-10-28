/**
 * Launcher for panel hosts (Pterodactyl, SparkedHost, and similar).
 *
 * Those hosts run `npm install` and then `node index.js`, with no build step
 * in between. This compiles the TypeScript source when the compiler is
 * available, then starts the bot in-process so shutdown signals from the
 * panel reach its graceful-shutdown handlers directly.
 *
 * Local development and Docker do not use this file; they run `dist/` as
 * built by `npm run build`.
 */

import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

let tsc;
try {
  tsc = require.resolve("typescript/bin/tsc");
} catch {
  // NOTE: Hosts that install with NODE_ENV=production skip devDependencies.
  // A previously built dist/ still runs; without one there is nothing to start.
  tsc = undefined;
}

if (tsc) {
  console.log("Building TypeScript source...");
  execFileSync(process.execPath, [tsc], { stdio: "inherit" });
} else if (!existsSync(new URL("./dist/index.js", import.meta.url))) {
  console.error(
    "dist/ is missing and TypeScript is not installed. " +
      "Run `npm install` without NODE_ENV=production, or `npm run build`.",
  );
  process.exit(1);
}

await import("./dist/index.js");
