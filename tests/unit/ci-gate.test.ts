// @vitest-environment node
/**
 * The production migration workflow runs only when CI passed for exactly the
 * commit being migrated. The gate must fail closed on anything unexpected.
 */
import { execFileSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { evaluateRuns } from "../../.github/scripts/ci-gate.mjs";

const SHA = "9650eeabfe1dfc8305c00532e76b124bc7323fee";
const OTHER = "065c9a27dbf9d8e6898fe7f96be092cbfbf8e408";

const run = (overrides: Record<string, unknown> = {}) => ({
  databaseId: 100,
  attempt: 1,
  headSha: SHA,
  headBranch: "main",
  event: "push",
  status: "completed",
  conclusion: "success",
  workflowName: "CI",
  createdAt: "2026-11-01T10:00:00Z",
  url: "https://github.com/o/r/actions/runs/100",
  ...overrides,
});

describe("evaluateRuns", () => {
  it("passes when the latest CI run for this commit on a push to main succeeded", () => {
    expect(evaluateRuns([run()], SHA)).toMatchObject({ ok: true });
  });

  it.each([
    ["there are no runs", []],
    ["the run is for another commit", [run({ headSha: OTHER })]],
    ["the run is from another branch", [run({ headBranch: "integrate/runner-platform" })]],
    ["the run was for a pull request, not the push to main", [run({ event: "pull_request" })]],
    ["the run is another workflow", [run({ workflowName: "Deploy database migrations" })]],
    ["the run failed", [run({ conclusion: "failure" })]],
    ["the run was cancelled", [run({ conclusion: "cancelled" })]],
    ["the run was skipped", [run({ conclusion: "skipped" })]],
    ["the run is still in progress", [run({ status: "in_progress", conclusion: "" })]],
    [
      "an older run succeeded but the latest failed",
      [run({ databaseId: 1 }), run({ databaseId: 2, createdAt: "2026-11-01T11:00:00Z", conclusion: "failure" })],
    ],
    [
      "one run succeeded while another is still running",
      [run({ databaseId: 1 }), run({ databaseId: 2, status: "queued" })],
    ],
    ["the creation time is unreadable", [run({ createdAt: "soon" })]],
    ["fields are missing", [{ headSha: SHA }]],
  ])("fails when %s", (_label, runs) => {
    expect(evaluateRuns(runs, SHA).ok).toBe(false);
  });

  it("passes when a newer run for the same commit succeeded after a failure", () => {
    const runs = [
      run({ databaseId: 1, conclusion: "failure" }),
      run({ databaseId: 2, createdAt: "2026-11-01T11:00:00Z" }),
    ];
    expect(evaluateRuns(runs, SHA)).toMatchObject({ ok: true, reason: expect.stringContaining("run 2") });
  });

  it.each([[undefined], [""], ["9650eea"], ["not-a-sha"], [SHA.toUpperCase()]])("rejects commit %j", (sha) => {
    expect(evaluateRuns([run()], sha as string | undefined).ok).toBe(false);
  });

  it.each([[null], [{}], ["[]"]])("rejects unreadable run lists like %j", (runs) => {
    expect(evaluateRuns(runs, SHA).ok).toBe(false);
  });
});

describe("ci-gate script", () => {
  const dirs: string[] = [];
  afterEach(() => dirs.splice(0).forEach((d) => rmSync(d, { recursive: true, force: true })));

  /** Run the script with a fake `gh` that prints `ghOutput` (or exits 1) and records its arguments. */
  function gate(ghScript: string, env: Record<string, string> = {}) {
    const dir = mkdtempSync(join(tmpdir(), "ci-gate-"));
    dirs.push(dir);
    writeFileSync(join(dir, "gh"), `#!/bin/sh\nprintf '%s\\n' "$@" > "${dir}/args"\n${ghScript}\n`);
    chmodSync(join(dir, "gh"), 0o755);
    let code = 0;
    let stdout = "";
    try {
      stdout = execFileSync(process.execPath, [".github/scripts/ci-gate.mjs"], {
        encoding: "utf8",
        env: {
          NODE_ENV: "test",
          PATH: `${dir}:${process.env.PATH}`,
          GITHUB_SHA: SHA,
          GITHUB_REPOSITORY: "mehr1sh/hyd_runners",
          GITHUB_REF: "refs/heads/main",
          ...env,
        },
      });
    } catch (error) {
      const e = error as { status: number; stdout: string };
      code = e.status;
      stdout = e.stdout;
    }
    let args: string[] = [];
    try {
      args = readFileSync(join(dir, "args"), "utf8").trim().split("\n");
    } catch {
      /* gh not called */
    }
    return { code, stdout, args };
  }

  const json = (runs: unknown) => `cat <<'EOF'\n${JSON.stringify(runs)}\nEOF`;

  it("asks gh for this commit's push runs of ci.yml on main and passes on success", () => {
    const { code, stdout, args } = gate(json([run()]));
    expect(code).toBe(0);
    expect(stdout).toContain("CI passed: run 100");
    const flag = (name: string) => args[args.indexOf(name) + 1];
    expect(args.slice(0, 2)).toEqual(["run", "list"]);
    expect(flag("--repo")).toBe("mehr1sh/hyd_runners");
    expect(flag("--workflow")).toBe("ci.yml");
    expect(flag("--commit")).toBe(SHA);
    expect(flag("--branch")).toBe("main");
    expect(flag("--event")).toBe("push");
  });

  it("fails closed when gh errors", () => {
    expect(gate("echo 'HTTP 403' >&2; exit 1")).toMatchObject({
      code: 1,
      stdout: expect.stringContaining("::error::"),
    });
  });

  it("fails closed when gh prints something that is not JSON", () => {
    expect(gate("echo 'rate limited'").code).toBe(1);
  });

  it("fails closed when no run matches", () => {
    expect(gate(json([])).code).toBe(1);
  });

  it("fails closed when gh ignores a filter and returns a pull-request run", () => {
    expect(gate(json([run({ event: "pull_request" })])).code).toBe(1);
  });

  it("refuses to run outside main without calling gh", () => {
    const result = gate(json([run()]), { GITHUB_REF: "refs/heads/integrate/runner-platform" });
    expect(result.code).toBe(1);
    expect(result.args).toEqual([]);
  });
});
