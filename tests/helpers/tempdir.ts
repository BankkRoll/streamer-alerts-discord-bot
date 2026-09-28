/**
 * Throwaway directories for filesystem-backed tests.
 *
 * Tests must never touch the project's own `data/` directory, so every file
 * driver under test gets its own directory beneath the OS temp root.
 *
 * @module tests/helpers/tempdir
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Create an empty directory under the OS temp root.
 *
 * @returns Absolute path to the new directory.
 */
export async function makeTempDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "streamer-alerts-test-"));
}

/**
 * Remove a directory created by {@link makeTempDir}, ignoring absence.
 *
 * @param directory - Path returned by {@link makeTempDir}.
 */
export async function removeTempDir(directory: string): Promise<void> {
  // NOTE: Windows can briefly hold a handle on a file a just-closed driver
  // wrote, so retries avoid a flaky EBUSY teardown.
  await rm(directory, { recursive: true, force: true, maxRetries: 5 });
}
