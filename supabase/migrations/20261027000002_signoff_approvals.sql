-- S4-1: approvals for more than runs. A brief sign-off is an approval about a
-- campaign's brief version; a run choice (the tagline) stays as it was.
-- Both reference their parent by (id, workspace_id), so an approval can only
-- be about a run or campaign in its own workspace.

alter table public.approvals drop constraint approvals_run_id_fkey;
alter table public.approvals alter column run_id drop not null;
alter table public.approvals
  add constraint approvals_run_fk foreign key (run_id, workspace_id)
    references public.agent_runs (id, workspace_id) on delete cascade,
  add column kind text not null default 'run_choice' check (kind in ('run_choice', 'brief_signoff')),
  add column campaign_id uuid,
  add column brief_version integer check (brief_version is null or brief_version >= 1),
  add constraint approvals_campaign_fk foreign key (campaign_id, workspace_id)
    references public.campaigns (id, workspace_id) on delete cascade,
  add constraint approvals_subject check (
    (kind = 'run_choice' and run_id is not null and campaign_id is null)
    or (kind = 'brief_signoff' and campaign_id is not null and brief_version is not null)
  );

drop index if exists public.approvals_run_idx;
create index approvals_run_idx on public.approvals (run_id, workspace_id);
create index approvals_campaign_idx on public.approvals (campaign_id, workspace_id);
create index approvals_pending_idx on public.approvals (workspace_id, created_at desc) where status = 'pending';
-- One open sign-off per campaign.
create unique index approvals_one_open_signoff on public.approvals (campaign_id) where kind = 'brief_signoff' and status = 'pending';

-- Membership once per query (as the Sprint 2 tables), replacing is_member() per row.
alter policy approvals_select on public.approvals
  using (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid())));
alter policy approvals_insert on public.approvals
  with check (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid())));
alter policy approvals_update on public.approvals
  using (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid())))
  with check (workspace_id in (select m.workspace_id from public.workspace_members m where m.user_id = (select auth.uid())));

-- A decided approval stays decided; its subject never changes.
create function public.approvals_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.workspace_id is distinct from old.workspace_id or new.kind is distinct from old.kind
     or new.run_id is distinct from old.run_id or new.campaign_id is distinct from old.campaign_id
     or new.brief_version is distinct from old.brief_version then
    raise exception 'An approval''s subject cannot be changed' using errcode = '42501';
  end if;
  if old.status <> 'pending' and (new.status, new.choice, new.reason, new.decided_by, new.decided_at)
       is distinct from (old.status, old.choice, old.reason, old.decided_by, old.decided_at) then
    raise exception 'A decided approval cannot be changed' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger approvals_guard before update on public.approvals
for each row execute function public.approvals_guard();

-- Campaign sign-off states. 'approved' means the current version is the
-- approved one; editing after approval returns to 'draft' and keeps
-- approved_version, so the page can say which version was signed off.
alter table public.campaigns drop constraint campaigns_status_check;
alter table public.campaigns
  add constraint campaigns_status_check check (status in ('drafting', 'draft', 'awaiting_signoff', 'approved')),
  add column approved_version integer check (approved_version is null or approved_version >= 1),
  add column approved_at timestamptz,
  add column approved_by uuid references auth.users (id),
  add column signoff_note text check (signoff_note is null or char_length(signoff_note) <= 500),
  add constraint campaigns_approved_le_current check (approved_version is null or approved_version <= current_version);

create index campaigns_approved_by_idx on public.campaigns (approved_by);
