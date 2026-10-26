-- F-13: every attempt of a model step is kept (rule 4), including why a reply
-- was sent back: [{ attempt, raw, truncated, problems[] }].
alter table public.agent_steps add column attempt_log jsonb not null default '[]'::jsonb
  check (jsonb_typeof(attempt_log) = 'array' and octet_length(attempt_log::text) <= 40000);
