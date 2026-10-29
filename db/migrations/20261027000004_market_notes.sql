-- S4-3: market notes from the web. Context items gain a small metadata field
-- (a market note's sources, the real companies it names, when it was
-- checked), and the usage ledger records web searches, which cost money too.

alter table public.context_items add column meta jsonb not null default '{}'::jsonb
  check (jsonb_typeof(meta) = 'object' and octet_length(meta::text) <= 20000);

alter table public.usage_ledger add column search_requests integer not null default 0 check (search_requests >= 0);
