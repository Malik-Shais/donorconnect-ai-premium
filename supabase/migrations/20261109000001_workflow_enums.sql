-- Stage 3: request review workflow. Enum changes live alone in this file because a newly added enum value
-- cannot be used in the same transaction that adds it (the Supabase CLI applies each file in one transaction).
-- 'open' (visible to donors) becomes 'approved'; unreviewed requests start as 'pending_review'.
alter type public.request_status rename value 'open' to 'approved';
alter type public.request_status add value if not exists 'pending_review' before 'approved';
alter type public.request_status add value if not exists 'rejected' after 'approved';
alter type public.offer_status   add value if not exists 'withdrawn';
