-- Release 2 / Workstream G: route search.
--
-- One typed search function over routes. It runs with the caller's rights
-- (security invoker), so the routes RLS policies decide what can be found:
-- published routes for everyone, plus drafts for their authors and managers.
-- Free text is matched as data (full-text query and an escaped ILIKE); the
-- natural-language parser in the app only ever fills these typed parameters.
-- No SQL is generated from user input.

create function public.search_routes(
  p_text text default null,
  p_near_lat double precision default null,
  p_near_lon double precision default null,
  p_radius_m integer default 5000,
  p_min_m numeric default null,
  p_max_m numeric default null,
  p_surface text[] default null,
  p_terrain text[] default null,
  p_difficulty text[] default null,
  p_lighting text[] default null,
  p_shade text[] default null,
  p_loop boolean default null,
  p_beginner boolean default null,
  p_verified boolean default null,
  p_water boolean default null,
  p_toilets boolean default null,
  p_min_rating numeric default null,
  p_no_open_reports boolean default false,
  p_sort text default 'relevance',
  p_limit integer default 50
)
returns table (id uuid, distance_from_m double precision, rating numeric, reviews bigint, open_reports bigint, rank real)
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_text text := nullif(btrim(p_text), '');
  v_query tsquery;
  v_like text;
  v_near extensions.geography;
begin
  if v_text is not null and char_length(v_text) > 200 then
    raise exception 'Search text is too long.' using errcode = '22023';
  end if;
  if (p_near_lat is null) <> (p_near_lon is null)
     or (p_near_lat is not null and (abs(p_near_lat) > 90 or abs(p_near_lon) > 180)) then
    raise exception 'Invalid search location.' using errcode = '22023';
  end if;
  if p_radius_m is null or p_radius_m not between 100 and 50000 then
    raise exception 'Search radius must be between 100 m and 50 km.' using errcode = '22023';
  end if;
  if (p_min_m is not null and p_min_m < 0) or (p_max_m is not null and p_max_m < 0)
     or (p_min_m is not null and p_max_m is not null and p_min_m > p_max_m) then
    raise exception 'Invalid distance range.' using errcode = '22023';
  end if;
  if p_min_rating is not null and p_min_rating not between 1 and 5 then
    raise exception 'Minimum rating must be between 1 and 5.' using errcode = '22023';
  end if;
  if p_sort not in ('relevance', 'nearest', 'distance_asc', 'distance_desc', 'rating', 'name') then
    raise exception 'Unknown sort order.' using errcode = '22023';
  end if;
  if not (coalesce(p_surface, '{}') <@ array['road', 'track', 'trail', 'mixed', 'unknown']
          and coalesce(p_terrain, '{}') <@ array['flat', 'rolling', 'hilly', 'unknown']
          and coalesce(p_difficulty, '{}') <@ array['easy', 'moderate', 'hard', 'unknown']
          and coalesce(p_lighting, '{}') <@ array['lit', 'partly_lit', 'unlit', 'unknown']
          and coalesce(p_shade, '{}') <@ array['good', 'some', 'little', 'unknown']) then
    raise exception 'Unknown route attribute.' using errcode = '22023';
  end if;

  if v_text is not null then
    v_query := websearch_to_tsquery('simple', v_text);
    v_like := '%' || replace(replace(replace(v_text, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  end if;
  if p_near_lat is not null then
    v_near := extensions.st_setsrid(extensions.st_makepoint(p_near_lon, p_near_lat), 4326)::extensions.geography;
  end if;

  return query
  with base as (
    select r.id, r.name, r.distance_m,
           case when v_near is null or r.start_point is null then null
                else extensions.st_distance(r.start_point, v_near) end as dist_from,
           case when v_text is null then 0::real
                else ts_rank(to_tsvector('simple', r.name || ' ' || coalesce(r.area, '') || ' ' || r.description), v_query)
                     + case when r.name ilike v_like then 1 else 0 end
                     + case when r.area ilike v_like then 0.5 else 0 end end::real as rnk
    from public.routes r
    where r.status <> 'archived'
      and (v_text is null
           or to_tsvector('simple', r.name || ' ' || coalesce(r.area, '') || ' ' || r.description) @@ v_query
           or r.name ilike v_like or r.area ilike v_like)
      and (v_near is null or (r.start_point is not null and extensions.st_dwithin(r.start_point, v_near, p_radius_m)))
      and (p_min_m is null or r.distance_m >= p_min_m)
      and (p_max_m is null or r.distance_m <= p_max_m)
      and (p_surface is null or r.surface = any (p_surface))
      and (p_terrain is null or r.terrain = any (p_terrain))
      and (p_difficulty is null or r.difficulty = any (p_difficulty))
      and (p_lighting is null or r.lighting = any (p_lighting))
      and (p_shade is null or r.shade = any (p_shade))
      and (p_loop is null or r.is_loop = p_loop)
      and (p_beginner is null or r.beginner_suitable = p_beginner)
      and (p_verified is null or r.verified = p_verified)
      and (p_water is null or r.water_refill = p_water)
      and (p_toilets is null or r.toilets = p_toilets)
  ),
  scored as (
    select b.*, s.rating as rt, coalesce(s.reviews, 0) as rv,
           (select count(*) from public.route_reports rp
             where rp.route_id = b.id and rp.resolved_at is null and rp.expires_at > now()) as reports
    from base b
    left join lateral public.route_review_summary(array[b.id]) s on true
  )
  select sc.id, sc.dist_from, sc.rt, sc.rv, sc.reports, sc.rnk
  from scored sc
  where (p_min_rating is null or sc.rt >= p_min_rating)
    and (not coalesce(p_no_open_reports, false) or sc.reports = 0)
  order by
    case when p_sort = 'nearest' then sc.dist_from end asc nulls last,
    case when p_sort = 'distance_asc' then sc.distance_m end asc,
    case when p_sort = 'distance_desc' then sc.distance_m end desc,
    case when p_sort = 'rating' then sc.rt end desc nulls last,
    case when p_sort = 'relevance' then sc.rnk end desc,
    case when p_sort = 'relevance' then sc.dist_from end asc nulls last,
    sc.name
  limit greatest(1, least(coalesce(p_limit, 50), 200));
end;
$$;

revoke all on function public.search_routes(text, double precision, double precision, integer, numeric, numeric, text[],
  text[], text[], text[], text[], boolean, boolean, boolean, boolean, boolean, numeric, boolean, text, integer) from public;
grant execute on function public.search_routes(text, double precision, double precision, integer, numeric, numeric, text[],
  text[], text[], text[], text[], boolean, boolean, boolean, boolean, boolean, numeric, boolean, text, integer)
  to anon, authenticated;
