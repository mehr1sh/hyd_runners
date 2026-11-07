#!/usr/bin/env node
/**
 * Fail-closed CI gate for db-deploy.yml. Exits 0 only when the most recent
 * "CI" workflow run (ci.yml) triggered by a push to main for exactly
 * GITHUB_SHA has completed with conclusion "success". Anything else (no run,
 * a run still in progress, a failed/cancelled latest run, unreadable output,
 * a gh error) exits 1.
 *
 * `gh run list` filters by workflow, commit, branch and event, but every
 * field is re-checked here so an ignored filter can never let a run through.
 */
import { execFileSync } from "node:child_process";
import { pathToFileURL } from "node:url";

export const EXPECTED = { workflowFile: "ci.yml", workflowName: "CI", branch: "main", event: "push" };
export const FIELDS = "databaseId,attempt,headSha,headBranch,event,status,conclusion,workflowName,createdAt,url";
const FULL_SHA = /^[0-9a-f]{40}$/;

/**
 * @typedef {{ databaseId: number, attempt?: number, headSha: string, headBranch: string, event: string,
 *   status: string, conclusion: string, workflowName: string, createdAt: string, url?: string }} Run
 * @param {unknown} runs  parsed `gh run list --json` output
 * @param {string | undefined} sha  the commit being migrated
 * @returns {{ ok: boolean, reason: string }}
 */
export function evaluateRuns(runs, sha, expected = EXPECTED) {
  if (typeof sha !== "string" || !FULL_SHA.test(sha)) return { ok: false, reason: `Not a full commit SHA: "${sha}".` };
  if (!Array.isArray(runs)) return { ok: false, reason: "Could not read the list of CI runs." };

  /** @type {Run[]} */
  const matching = runs.filter(
    (r) =>
      r &&
      typeof r === "object" &&
      r.headSha === sha &&
      r.workflowName === expected.workflowName &&
      r.headBranch === expected.branch &&
      r.event === expected.event,
  );
  const where = `${expected.workflowName} run for a ${expected.event} to ${expected.branch} at ${sha}`;
  if (matching.length === 0) return { ok: false, reason: `No ${where}.` };
  if (matching.some((r) => Number.isNaN(Date.parse(r.createdAt))))
    return { ok: false, reason: `A ${where} has no readable creation time.` };

  const pending = matching.find((r) => r.status !== "completed");
  if (pending) return { ok: false, reason: `${where} is still ${pending.status} (run ${pending.databaseId}).` };

  // A newer run for the same commit (e.g. a re-trigger) supersedes older ones.
  const latest = [...matching].sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt) || b.databaseId - a.databaseId,
  )[0];
  if (latest.conclusion !== "success")
    return { ok: false, reason: `Latest ${where} concluded "${latest.conclusion}" (run ${latest.databaseId}).` };
  return {
    ok: true,
    reason: `CI passed: run ${latest.databaseId}, attempt ${latest.attempt ?? 1} ${latest.url ?? ""}`.trim(),
  };
}

function main() {
  const { GITHUB_SHA: sha, GITHUB_REPOSITORY: repo, GITHUB_REF: ref } = process.env;
  if (ref !== `refs/heads/${EXPECTED.branch}`) return fail(`Run from ${EXPECTED.branch} only (got ${ref}).`);
  if (!repo) return fail("GITHUB_REPOSITORY is not set.");

  let output;
  try {
    output = execFileSync(
      "gh",
      [
        "run",
        "list",
        "--repo",
        repo,
        "--workflow",
        EXPECTED.workflowFile,
        "--commit",
        String(sha),
        "--branch",
        EXPECTED.branch,
        "--event",
        EXPECTED.event,
        "--limit",
        "50",
        "--json",
        FIELDS,
      ],
      { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
    );
  } catch (error) {
    return fail(`Could not list CI runs: ${error instanceof Error ? error.message : error}`);
  }

  let runs;
  try {
    runs = JSON.parse(output);
  } catch {
    return fail("gh returned output that is not JSON.");
  }
  const verdict = evaluateRuns(runs, sha);
  if (!verdict.ok) return fail(verdict.reason);
  console.log(verdict.reason);
}

/** @param {string} reason */
function fail(reason) {
  console.log(`::error::${reason}`);
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) main();
