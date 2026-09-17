// The verifier may clean only a named child of this repository-owned parent.
// Do not accept paths here: the value is an artifact run name, not a location.
import path from "node:path";

export const repoRoot = path.resolve(import.meta.dirname, "..");
export const artifactParent = path.join(repoRoot, ".local-logs", "yr-003-baseline");
const DEFAULT_ARTIFACT_RUN = "current";
const SAFE_ARTIFACT_RUN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;

export function resolveArtifactRoot(value = process.env.YR_003_ARTIFACT_DIR) {
  const run = value === undefined ? DEFAULT_ARTIFACT_RUN : value;
  if (
    typeof run !== "string" ||
    run === "." ||
    run === ".." ||
    path.isAbsolute(run) ||
    run.includes("/") ||
    run.includes("\\") ||
    !SAFE_ARTIFACT_RUN.test(run)
  ) {
    throw new Error(
      "YR_003_ARTIFACT_DIR must be a simple artifact run name (letters, numbers, ., _, -), not a path.",
    );
  }

  const result = path.resolve(artifactParent, run);
  const relative = path.relative(artifactParent, result);
  if (!relative || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("YR_003_ARTIFACT_DIR resolved outside the repository-owned artifact parent.");
  }
  return result;
}
