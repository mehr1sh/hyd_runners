/**
 * Minimal stand-in for the Supabase query builder used by the dashboard
 * loaders. Each table resolves to a configured `{ data, error }`; tables not
 * configured resolve to an empty list. Chained filters are recorded so a
 * table can answer differently per query (e.g. workout_logs with `.in()`).
 */
type DbError = { message: string; code: string };
export type QueryResult = { data: unknown; error: DbError | null };
export type Query = { table: string; calls: { method: string; args: unknown[] }[] };
type TableResponse = QueryResult | ((query: Query) => QueryResult);

const CHAIN = [
  "select",
  "update",
  "eq",
  "neq",
  "gte",
  "gt",
  "lt",
  "lte",
  "order",
  "limit",
  "in",
  "not",
  "like",
  "or",
  "is",
  "range",
  "ilike",
];

export const missingTable = (table: string): QueryResult => ({
  data: null,
  error: { message: `Could not find the table 'public.${table}' in the schema cache`, code: "PGRST205" },
});

export function fakeSupabase(
  tables: Record<string, TableResponse> = {},
  claims: Record<string, unknown> | null = { sub: "user-1", email: "asha@example.test" },
) {
  const queries: Query[] = [];
  const resolve = (query: Query): QueryResult => {
    const entry = tables[query.table];
    if (!entry) return { data: [], error: null };
    return typeof entry === "function" ? entry(query) : entry;
  };

  function from(table: string) {
    const query: Query = { table, calls: [] };
    queries.push(query);
    const builder: Record<string, unknown> = {};
    for (const method of CHAIN)
      builder[method] = (...args: unknown[]) => {
        query.calls.push({ method, args });
        return builder;
      };
    builder.maybeSingle = async () => {
      const { data, error } = resolve(query);
      return { data: Array.isArray(data) ? (data[0] ?? null) : data, error };
    };
    builder.then = (onFulfilled: (r: QueryResult) => unknown, onRejected?: (e: unknown) => unknown) => {
      const result = resolve(query);
      // select(columns, { count: "exact", head: true }) answers with a count.
      const counted = query.calls.some(
        (c) => c.method === "select" && (c.args[1] as { count?: string } | undefined)?.count,
      );
      const value = counted
        ? { ...result, count: Array.isArray(result.data) ? result.data.length : 0, data: null }
        : result;
      return Promise.resolve(value).then(onFulfilled, onRejected);
    };
    return builder;
  }

  /**
   * Database functions. `rpc:<name>` in `tables` overrides; otherwise the
   * aggregates are derived from the configured tables, as the real functions
   * derive them from the caller's rows.
   */
  async function rpc(name: string, args: Record<string, unknown> = {}): Promise<QueryResult> {
    const override = tables[`rpc:${name}`];
    if (override) return typeof override === "function" ? override({ table: `rpc:${name}`, calls: [] }) : override;
    if (name === "my_reward_totals") {
      const ledger = resolve({ table: "xp_ledger", calls: [] });
      if (ledger.error) return ledger;
      const rows = (ledger.data ?? []) as { delta_xp: number; delta_coins: number }[];
      return {
        data: [
          {
            total_xp: rows.reduce((s, r) => s + r.delta_xp, 0),
            total_coins: rows.reduce((s, r) => s + r.delta_coins, 0),
            ledger_rows: rows.length,
          },
        ],
        error: null,
      };
    }
    if (name === "my_active_dates") {
      const logs = resolve({ table: "workout_logs", calls: [{ method: "eq", args: ["status", "completed"] }] });
      if (logs.error) return logs;
      const format = new Intl.DateTimeFormat("en-CA", { timeZone: String(args.p_timezone ?? "UTC") });
      const min = Number(args.p_min_seconds ?? 0);
      const rows = (logs.data ?? []) as { started_at: string; duration_seconds: number | null }[];
      const dates = [
        ...new Set(
          rows.filter((r) => (r.duration_seconds ?? 0) >= min).map((r) => format.format(new Date(r.started_at))),
        ),
      ].sort();
      return { data: dates, error: null };
    }
    return { data: null, error: null };
  }

  return {
    from,
    rpc,
    auth: { getClaims: async () => ({ data: claims ? { claims } : null, error: null }) },
    queries,
  };
}

export type FakeSupabase = ReturnType<typeof fakeSupabase>;
