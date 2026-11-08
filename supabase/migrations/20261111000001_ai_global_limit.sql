-- Stage 5: a project-wide ceiling on AI model calls, so one busy hour cannot exhaust a free-tier quota for everyone.
-- (The per-user limit 'ai.chat' = 20/hour already exists.) Tune by editing this row; no code change needed.
insert into public.rate_limit_rules (action, max_hits, window_seconds, scope) values ('ai.global', 200, 3600, 'anon');
