-- S2-5: the Business Context store. Everything Studio knows about a brand, as
-- searchable items (kit rules, products, segment and insight summaries, and
-- later agent results), with edges between them. Postgres full-text search for
-- now (Q3); embeddings can be added as a column when an agent needs them.

create table public.context_items (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  brand_id uuid not null,
  kind text not null check (kind in ('brand_voice', 'brand_rule', 'legal', 'product', 'segment', 'insight', 'result')),
  title text not null check (char_length(title) between 1 and 200),
  body text not null default '' check (char_length(body) <= 4000),
  source text not null check (char_length(source) <= 200),
  -- Stable key for items Studio maintains itself (e.g. 'rule:dont:2',
  -- 'product:<id>', 'segment:lapsed'), so re-syncing updates rather than duplicates.
  source_ref text check (source_ref is null or char_length(source_ref) <= 200),
  tags text[] not null default '{}' check (cardinality(tags) <= 20),
  created_by_kind text not null default 'system' check (created_by_kind in ('system', 'person', 'agent')),
  search tsvector generated always as (
    setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', body), 'B')
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (brand_id, source_ref),
  foreign key (brand_id, workspace_id) references public.brands (id, workspace_id) on delete cascade
);

create index context_items_brand_idx on public.context_items (brand_id, workspace_id, kind);
create index context_items_search_idx on public.context_items using gin (search);

create trigger context_items_touch before update on public.context_items
for each row execute function public.touch_updated_at();

create table public.context_edges (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  from_item uuid not null,
  to_item uuid not null,
  relation text not null check (relation in ('mentions', 'derived_from', 'supports', 'contradicts')),
  created_at timestamptz not null default now(),
  unique (from_item, to_item, relation),
  foreign key (from_item, workspace_id) references public.context_items (id, workspace_id) on delete cascade,
  foreign key (to_item, workspace_id) references public.context_items (id, workspace_id) on delete cascade
);

create index context_edges_from_idx on public.context_edges (from_item, workspace_id);
create index context_edges_to_idx on public.context_edges (to_item, workspace_id);

alter table public.context_items enable row level security;
alter table public.context_edges enable row level security;

create policy context_items_all on public.context_items for all to authenticated
  using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
create policy context_edges_all on public.context_edges for all to authenticated
  using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));

revoke all on public.context_items, public.context_edges from anon;
