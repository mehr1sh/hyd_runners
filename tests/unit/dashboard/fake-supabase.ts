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
    builder.then = (onFulfilled: (r: QueryResult) => unknown, onRejected?: (e: unknown) => unknown) =>
      Promise.resolve(resolve(query)).then(onFulfilled, onRejected);
    return builder;
  }

  return {
    from,
    rpc: async () => ({ data: [], error: null }),
    auth: { getClaims: async () => ({ data: claims ? { claims } : null, error: null }) },
    queries,
  };
}

export type FakeSupabase = ReturnType<typeof fakeSupabase>;
