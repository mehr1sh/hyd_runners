// @vitest-environment node
/**
 * The local demo seed (scripts/demo-data) must never reach Vercel Production
 * or Preview, which share the production database. These tests pin the
 * guards and the isolation: nothing in migrations, supabase/seed.sql, the
 * deploy workflows or the app refers to the demo seed, demo accounts are
 * fictional and labelled, and sample professionals are never verified.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { assertLocalTarget, dbContainerFor, isLoopbackUrl, parseStatusEnv } from "../../scripts/demo-data/guard.mjs";
import { DEMO_EMAIL_DOMAIN, PEOPLE, demoId, displayNameFor, emailFor, personId } from "../../scripts/demo-data/people";
import { haversine, measure, positionAt, toGpx, trackPoints, type LonLat } from "../../scripts/demo-data/gpx";

const root = join(__dirname, "../..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const LOCAL = { apiUrl: "http://127.0.0.1:54321", dbUrl: "postgresql://postgres:postgres@127.0.0.1:54322/postgres" };

describe("demo seed guard", () => {
  it("accepts the local stack", () => {
    expect(() => assertLocalTarget({ ...LOCAL, env: {} })).not.toThrow();
    expect(() =>
      assertLocalTarget({ ...LOCAL, env: { NEXT_PUBLIC_SUPABASE_URL: "http://localhost:54321" } }),
    ).not.toThrow();
  });

  it("refuses Vercel, production mode and hosted projects", () => {
    expect(() => assertLocalTarget({ ...LOCAL, env: { VERCEL: "1" } })).toThrow(/Vercel/);
    expect(() => assertLocalTarget({ ...LOCAL, env: { VERCEL_ENV: "preview" } })).toThrow(/Vercel/);
    expect(() => assertLocalTarget({ ...LOCAL, env: { NODE_ENV: "production" } })).toThrow(/production/);
    expect(() => assertLocalTarget({ ...LOCAL, apiUrl: "https://abc.supabase.co", env: {} })).toThrow(/not local/);
    expect(() =>
      assertLocalTarget({ ...LOCAL, dbUrl: "postgresql://postgres@db.abc.supabase.co:5432/postgres", env: {} }),
    ).toThrow(/not local/);
    expect(() => assertLocalTarget({ ...LOCAL, env: { NEXT_PUBLIC_SUPABASE_URL: "https://abc.supabase.co" } })).toThrow(
      /NEXT_PUBLIC_SUPABASE_URL/,
    );
    expect(() => assertLocalTarget({ apiUrl: undefined, dbUrl: undefined, env: {} })).toThrow();
  });

  it("only treats loopback hosts as local", () => {
    expect(isLoopbackUrl("http://127.0.0.1:54321")).toBe(true);
    expect(isLoopbackUrl("http://localhost:54321")).toBe(true);
    expect(isLoopbackUrl("http://127.0.0.1.example.com")).toBe(false);
    expect(isLoopbackUrl("not a url")).toBe(false);
  });

  it("reads `supabase status -o env` and the local container name", () => {
    expect(
      parseStatusEnv('API_URL="http://127.0.0.1:54321"\nDB_URL="postgresql://x@127.0.0.1:54322/postgres"\n'),
    ).toEqual({
      API_URL: "http://127.0.0.1:54321",
      DB_URL: "postgresql://x@127.0.0.1:54322/postgres",
    });
    expect(dbContainerFor(read("supabase/config.toml"))).toBe("supabase_db_hyd-runners");
  });

  it("never reads .env.local or links to the hosted project", () => {
    for (const f of ["run.mjs", "seed.ts", "guard.mjs"]) {
      const src = read(`scripts/demo-data/${f}`);
      expect(src).not.toMatch(/\.env\.local|--linked|db push|dotenv/);
    }
  });
});

describe("demo data isolation", () => {
  const demoMarkers = /demo\.hydrunners\.test|scripts\/demo-data|demo:seed/;

  it("is not part of migrations, supabase/seed.sql or the seed config", () => {
    for (const f of readdirSync(join(root, "supabase/migrations"))) {
      expect(read(`supabase/migrations/${f}`), f).not.toMatch(demoMarkers);
    }
    expect(read("supabase/seed.sql")).not.toMatch(demoMarkers);
    const sqlPaths = /sql_paths\s*=\s*\[([^\]]*)\]/.exec(read("supabase/config.toml"))?.[1] ?? "";
    expect(sqlPaths).not.toMatch(/demo/);
  });

  it("is never run by the database deploy workflows", () => {
    for (const f of ["db-deploy.yml", "db-apply.yml", "db-verify.yml"]) {
      const src = read(`.github/workflows/${f}`);
      expect(src, f).not.toMatch(demoMarkers);
      expect(src, f).not.toMatch(/--include-seed/);
    }
  });

  it("is not imported by the app", () => {
    const walk = (dir: string): string[] =>
      readdirSync(join(root, dir), { withFileTypes: true }).flatMap((e) =>
        e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)],
      );
    for (const f of walk("src").filter((x) => /\.(ts|tsx)$/.test(x))) {
      expect(read(f), f).not.toMatch(/scripts\/demo-data|demo\.hydrunners\.test/);
    }
  });

  it("never marks sample professionals verified or creates bookings or payments", () => {
    for (const f of ["community.sql", "social.sql"]) {
      const sql = read(`scripts/demo-data/${f}`);
      expect(sql, f).not.toMatch(/verification_status\s*=\s*'verified'|'verified'\s*,\s*now\(\)|hyd\.verifying/);
      expect(sql, f).not.toMatch(/insert into public\.(bookings|professional_slots)/);
      expect(sql, f).not.toMatch(/payment_status/);
    }
  });
});

describe("demo people", () => {
  it("are fictional, labelled and on a reserved domain", () => {
    expect(DEMO_EMAIL_DOMAIN.endsWith(".test")).toBe(true);
    const ids = PEOPLE.map(personId);
    expect(new Set(ids).size).toBe(PEOPLE.length);
    expect(new Set(PEOPLE.map((p) => p.key)).size).toBe(PEOPLE.length);
    for (const p of PEOPLE) {
      expect(emailFor(p)).toMatch(/^[a-z]+@demo\.hydrunners\.test$/);
      expect(displayNameFor(p)).toMatch(/ \(sample\)$/);
      expect(displayNameFor(p).length).toBeLessThanOrEqual(60);
    }
  });

  it("use ids that reset.sql recognises, numbered as the SQL expects", () => {
    const pattern = /^de[0-9]{6}-0000-4000-8000-[0-9]{12}$/;
    expect(read("scripts/demo-data/reset.sql")).toContain("^de[0-9]{6}-0000-4000-8000-[0-9]{12}$");
    for (const p of PEOPLE) expect(personId(p)).toMatch(pattern);
    expect(demoId(13, 1999)).toBe("de000013-0000-4000-8000-000000001999");
    expect(PEOPLE.map((p) => p.n)).toEqual(Array.from({ length: PEOPLE.length }, (_, i) => i + 1));
    expect(read("scripts/demo-data/community.sql")).toContain(`pg_temp.p(${PEOPLE.length})`);
  });
});

describe("sample GPX tracks", () => {
  // About 1 km heading north, then a short jog east.
  const path: LonLat[] = [
    [78.42, 17.42],
    [78.42, 17.429],
    [78.421, 17.429],
  ];
  const m = measure(path);

  it("follow the route out and back", () => {
    expect(positionAt(m, 0, false)).toEqual(path[0]);
    expect(haversine(positionAt(m, m.length, false), path[2])).toBeLessThan(0.01);
    expect(haversine(positionAt(m, 2 * m.length, false), path[0])).toBeLessThan(0.01);
    expect(haversine(positionAt(m, m.length, true), path[0])).toBeLessThan(0.01);
  });

  it("cover the planned distance at the planned pace", () => {
    const start = new Date("2026-11-01T00:30:00Z");
    const points = trackPoints({
      route: m,
      loop: false,
      start,
      distanceM: 5000,
      plan: [{ untilM: Infinity, pace: 360 }],
      seed: 1,
    });
    let d = 0;
    for (let i = 1; i < points.length; i++)
      d += haversine([points[i - 1].lon, points[i - 1].lat], [points[i].lon, points[i].lat]);
    expect(d).toBeGreaterThan(4950);
    expect(d).toBeLessThan(5150);
    const seconds = (points[points.length - 1].t.getTime() - start.getTime()) / 1000;
    expect(seconds / 5).toBeGreaterThan(360 * 0.95);
    expect(seconds / 5).toBeLessThan(360 * 1.05);
  });

  it("are deterministic and say they are sample data", () => {
    const opts = {
      route: m,
      loop: false,
      start: new Date(0),
      distanceM: 1000,
      plan: [{ untilM: Infinity, pace: 400 }],
      seed: 7,
    };
    expect(trackPoints(opts)).toEqual(trackPoints(opts));
    const gpx = toGpx("A <b> & c", trackPoints(opts));
    expect(gpx).toContain("Not a real recording");
    expect(gpx).toContain("A &lt;b> &amp; c");
    expect(gpx).not.toMatch(/<ele>|<hr>/);
  });
});
