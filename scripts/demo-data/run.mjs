#!/usr/bin/env node
/**
 * Local demo data: `pnpm demo:seed`, `pnpm demo:reset`, `pnpm demo:check`.
 *
 * Talks only to the local Supabase stack (`supabase start`): API keys come
 * from `supabase status`, never from the app's env files, and SQL runs with psql
 * inside the local database container. See docs/demo-data.md.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";
import { assertLocalTarget, dbContainerFor, parseStatusEnv } from "./guard.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const command = process.argv[2] ?? "seed";
if (!["seed", "reset", "check"].includes(command)) {
  console.error("Usage: node scripts/demo-data/run.mjs seed|reset|check");
  process.exit(2);
}

let status;
try {
  status = parseStatusEnv(
    execFileSync("pnpm", ["exec", "supabase", "status", "-o", "env"], {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }),
  );
} catch {
  console.error("The local Supabase stack is not running. Start it with `pnpm db:start`.");
  process.exit(1);
}

try {
  assertLocalTarget({ apiUrl: status.API_URL, dbUrl: status.DB_URL, env: process.env });
} catch (e) {
  console.error(e.message);
  process.exit(1);
}

const container = dbContainerFor(readFileSync(resolve(root, "supabase/config.toml"), "utf8"));
function psql(sql) {
  return execFileSync(
    "docker",
    [
      "exec",
      "-i",
      container,
      "psql",
      "-U",
      "postgres",
      "-X",
      "-q",
      "-t",
      "-A",
      "-v",
      "ON_ERROR_STOP=1",
      "-1",
      "-f",
      "-",
    ],
    { input: sql, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
}

// Server modules read these when imported.
process.env.NEXT_PUBLIC_SUPABASE_URL = status.API_URL;
process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = status.PUBLISHABLE_KEY || status.ANON_KEY;
process.env.SUPABASE_SECRET_KEY = status.SECRET_KEY || status.SERVICE_ROLE_KEY;

const jiti = createJiti(import.meta.url, {
  alias: { "@/": `${root}/src/`, "server-only": `${here}/server-only-stub.mjs` },
});
const { run } = await jiti.import(`${here}/seed.ts`);
try {
  await run(command, { psql, sqlDir: here });
} catch (e) {
  console.error(`\nDemo data ${command} failed: ${e instanceof Error ? e.message : e}`);
  process.exit(1);
}
