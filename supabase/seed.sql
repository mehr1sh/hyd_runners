-- Local development seed data. Runs on `supabase db reset` only.
-- Everything here is SAMPLE data: names are real public places in Hyderabad,
-- but coordinates are approximate and marked unverified. Do not present
-- these rows as real community activity.

insert into public.locations (id, name, kind, latitude, longitude, address, verified) values
  ('00000000-0000-4000-8000-000000000101', 'KBR National Park (sample)', 'park', 17.423900, 78.421500, 'Jubilee Hills, Hyderabad', false),
  ('00000000-0000-4000-8000-000000000102', 'Necklace Road, Hussain Sagar (sample)', 'lake_loop', 17.423900, 78.473800, 'Necklace Road, Hyderabad', false),
  ('00000000-0000-4000-8000-000000000103', 'GMC Balayogi Athletic Stadium, Gachibowli (sample)', 'track', 17.447400, 78.348900, 'Gachibowli, Hyderabad', false),
  ('00000000-0000-4000-8000-000000000104', 'Botanical Garden, Kondapur (sample)', 'park', 17.459300, 78.357000, 'Kondapur, Hyderabad', false);

insert into public.events (id, title, description, starts_at, ends_at, location_id, capacity, status) values
  ('00000000-0000-4000-8000-000000000201', 'Sample: Beginner walk-run', 'Placeholder event for local development.',
   (date_trunc('week', now()) + interval '12 days 0 hours 30 minutes'),
   (date_trunc('week', now()) + interval '12 days 1 hour 30 minutes'),
   '00000000-0000-4000-8000-000000000101', 40, 'published');
