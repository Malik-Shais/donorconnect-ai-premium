-- Aggregate matching status for a requester's OWN requests: counts of offers by status, nothing about the donors.
-- Used by the AI assistant (minimum data: counts only). Requesters cannot read raw offers (RLS), and owner_request_offers() would audit a contact
-- disclosure, so a dedicated aggregate is the smallest safe surface. Only the caller's own requests are visible; other roles get no rows.
create function public.requester_match_summary()
returns table (request_id bigint, invited int, accepted int, declined int, withdrawn int)
language sql stable security definer set search_path = '' as $$
  select r.id,
         (count(o.id) filter (where o.status = 'invited'))::int, (count(o.id) filter (where o.status = 'accepted'))::int,
         (count(o.id) filter (where o.status = 'declined'))::int, (count(o.id) filter (where o.status = 'withdrawn'))::int
  from public.blood_requests r
  left join public.offers o on o.request_id = r.id
  where r.requester_id = (select auth.uid()) and public.current_app_role() = 'requester'
  group by r.id order by r.id desc limit 10
$$;
revoke all on function public.requester_match_summary() from public, anon;
grant execute on function public.requester_match_summary() to authenticated;
