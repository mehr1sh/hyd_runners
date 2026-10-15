# Feature folders

Each folder is owned by one feature area (see `CONTRIBUTING.md`). Put a feature's server actions, queries, components and pure logic here, not in `src/components` or `src/lib`.

Suggested layout inside a feature:

```
src/features/<feature>/
  actions.ts        # "use server" mutations (validate with contracts, then Supabase)
  queries.ts        # server-only reads ("server-only")
  components/       # feature UI
  logic/            # pure TypeScript (no I/O) — unit-test this
  README.md         # scope and decisions for the feature
```

Import shared entities from `@/lib/contracts`; never redefine them here.
