-- C8-1: people's decisions on compliance review items. The findings
-- themselves are not stored: they are worked out on request from the ad (its
-- picture, words, layout and frozen kit) and the brand's kit as it is now
-- (src/lib/compliance). A person accepts a review item, or marks it not
-- acceptable, on the ad's Compliance view (Q3: inline, not in the approvals
-- inbox, since it changes what a download holds, not what is published or
-- spent). A decision names the finding by its hash, so it applies only while
-- the finding is unchanged: a redraw, an edit or a changed rule makes the
-- finding new, and it is Review again.
--
-- Rule 4: every decision records who made it and when, set here from the
-- session (not from what the app sends). Decisions are append-only: a person
-- who changes their mind adds a later decision, and the latest counts.
-- Rule 7: workspace_id with row-level security, and the ad referenced by
-- (id, workspace_id). Everything here runs as the tables' owner, so it needs
-- no superuser (Neon).

create table public.compliance_decisions (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  variant_id uuid not null,
  -- The finding's language and size; both null for a finding about the whole ad (each don't rule).
  lang text check (lang is null or lang ~ '^[a-z]{2}-[A-Z]{2}$'),
  size text check (size is null or size ~ '^[0-9]{2,4}x[0-9]{2,4}$'),
  -- The rule's key: "contrast", "logo" and so on, or "dont:<hash of the rule>".
  rule text not null check (rule ~ '^[a-z]+(:[0-9a-f]{16})?$'),
  finding_hash text not null check (finding_hash ~ '^[0-9a-f]{64}$'),
  decision text not null check (decision in ('accept', 'reject')),
  note text check (note is null or char_length(note) <= 500),
  decided_by uuid not null references auth.users (id),
  -- The decider's email at the time, for the view and the launch pack's manifest (auth.users isn't readable by the app's role).
  decided_by_name text not null check (char_length(decided_by_name) between 1 and 320),
  decided_at timestamptz not null default clock_timestamp(),
  check ((lang is null) = (size is null)),
  unique (id, workspace_id),
  foreign key (variant_id, workspace_id) references public.ad_variants (id, workspace_id) on delete cascade
);

create index compliance_decisions_workspace_idx on public.compliance_decisions (workspace_id);
create index compliance_decisions_variant_idx on public.compliance_decisions (variant_id, workspace_id, decided_at);
create index compliance_decisions_decided_by_idx on public.compliance_decisions (decided_by);

-- Who and when come from the session, whatever the insert says.
create function public.compliance_decisions_stamp() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  who uuid := auth.uid();
  email text;
begin
  if who is null then
    raise exception 'A compliance decision needs a signed-in person' using errcode = '42501';
  end if;
  select u.email::text into email from auth.users u where u.id = who;
  new.decided_by := who;
  new.decided_by_name := coalesce(nullif(email, ''), 'a member of this workspace');
  new.decided_at := clock_timestamp();
  return new;
end
$$;

revoke all on function public.compliance_decisions_stamp() from public;

create trigger compliance_decisions_stamp before insert on public.compliance_decisions
for each row execute function public.compliance_decisions_stamp();

alter table public.compliance_decisions enable row level security;

create policy compliance_decisions_select on public.compliance_decisions for select to authenticated using (public.is_member(workspace_id));
create policy compliance_decisions_insert on public.compliance_decisions for insert to authenticated
  with check (public.is_member(workspace_id) and decided_by = (select auth.uid()));

revoke all on public.compliance_decisions from anon;
-- Append-only: members read and add decisions; the rest of the default grant is taken back.
revoke update, delete, truncate, references, trigger on public.compliance_decisions from authenticated;
