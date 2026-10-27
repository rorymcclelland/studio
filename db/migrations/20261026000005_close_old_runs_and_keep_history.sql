-- Sprint 3 review fixes, the parts that change data or remove a permission (findings 7 and 13).

-- 7. Sprint 3 replaced the tagline-only workflow function with one for every
--    agent. A tagline run still waiting for approval under the old function
--    can never finish, so it is closed as expired, as an unanswered approval
--    would have been.
update public.approvals set status = 'expired'
where status = 'pending' and run_id in (select id from public.agent_runs where agent = 'tagline' and status = 'awaiting_approval');
update public.agent_runs set status = 'expired', completed_at = now(),
  error = 'Closed when the run framework changed (Sprint 3); no decision had been made'
where agent = 'tagline' and status = 'awaiting_approval';

-- 13. History is append-only: campaigns can't be deleted (which would take
--     their versions with them).
drop policy campaigns_delete on public.campaigns;
revoke delete, truncate on public.campaigns from authenticated;

