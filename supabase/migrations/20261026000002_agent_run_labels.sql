-- F-4: runs from any agent. A run carries a short label for lists (for
-- example "Fernhollow Outfitters: find audiences") and, when it is about a
-- brand, that brand, so runs can be listed per brand. The brand reference uses
-- (brand_id, workspace_id), so a run can only point at a brand in its own
-- workspace.

alter table public.agent_runs
  add column label text check (label is null or char_length(label) <= 200),
  add column brand_id uuid,
  add constraint agent_runs_brand_fk foreign key (brand_id, workspace_id)
    references public.brands (id, workspace_id) on delete set null (brand_id);

create index agent_runs_brand_idx on public.agent_runs (brand_id, workspace_id) where brand_id is not null;
