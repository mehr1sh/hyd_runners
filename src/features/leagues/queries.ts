import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DatabaseQueryError } from "@/lib/supabase/errors";
import type { LeagueKind, ScoringKey } from "./logic";

export type League = {
  id: string;
  name: string;
  kind: LeagueKind;
  description: string | null;
  startsOn: string;
  endsOn: string;
  scoring: Record<ScoringKey, number>;
  status: "draft" | "active" | "completed" | "cancelled";
};

const COLS = "id, name, kind, description, starts_on, ends_on, scoring, status";
const toLeague = (r: Record<string, unknown>): League => ({
  id: r.id as string,
  name: r.name as string,
  kind: r.kind as LeagueKind,
  description: (r.description as string | null) ?? null,
  startsOn: r.starts_on as string,
  endsOn: r.ends_on as string,
  scoring: r.scoring as Record<ScoringKey, number>,
  status: r.status as League["status"],
});

export async function listLeagues(supabase: SupabaseClient, userId: string) {
  const [leagues, mine] = await Promise.all([
    supabase.from("leagues").select(COLS).order("starts_on", { ascending: false }).limit(50),
    supabase.from("league_members").select("league_id, team_id").eq("user_id", userId),
  ]);
  if (leagues.error) throw new DatabaseQueryError("leagues", leagues.error);
  const myTeams = new Map(
    ((mine.data ?? []) as { league_id: string; team_id: string }[]).map((m) => [m.league_id, m.team_id]),
  );
  return ((leagues.data ?? []) as Record<string, unknown>[]).map((r) => ({
    ...toLeague(r),
    myTeamId: myTeams.get(r.id as string) ?? null,
  }));
}

export type Standings = {
  teams: {
    teamId: string;
    name: string;
    affiliation: string;
    members: number;
    points: number;
    perMember: number | null;
    activeDays: number;
    km: number;
  }[];
  individuals: {
    name: string | null;
    me: boolean;
    team: string;
    points: number;
    activeDays: number;
    consistentWeeks: number;
    groupRuns: number;
    km: number;
    challenges: number;
    events: number;
  }[];
  computedAt: string;
};

export async function leagueDetail(supabase: SupabaseClient, id: string, userId: string) {
  const [league, teams, mine, admin, standings, codes] = await Promise.all([
    supabase.from("leagues").select(COLS).eq("id", id).maybeSingle(),
    supabase.from("league_teams").select("id, name, affiliation, club_id").eq("league_id", id).order("name"),
    supabase.from("league_members").select("team_id").eq("league_id", id).eq("user_id", userId).maybeSingle(),
    supabase.from("league_admins").select("user_id").eq("league_id", id).eq("user_id", userId).maybeSingle(),
    supabase.rpc("league_standings", { p_league: id }),
    supabase.rpc("league_team_codes", { p_league: id }),
  ]);
  if (league.error) throw new DatabaseQueryError("leagues", league.error);
  if (!league.data) return null;
  const codeMap = new Map(
    ((codes.data ?? []) as { team_id: string; join_code: string | null }[]).map((c) => [c.team_id, c.join_code]),
  );
  return {
    league: toLeague(league.data),
    teams: ((teams.data ?? []) as { id: string; name: string; affiliation: string; club_id: string | null }[]).map(
      (t) => ({
        ...t,
        joinCode: codeMap.get(t.id) ?? null,
      }),
    ),
    myTeamId: (mine.data?.team_id as string | undefined) ?? null,
    isAdmin: Boolean(admin.data) || (codes.data ?? []).length > 0,
    standings: standings.error ? null : (standings.data as Standings),
  };
}
