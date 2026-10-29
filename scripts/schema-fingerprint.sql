-- Schema fingerprint: one hash per kind of object (columns, constraints, indexes, policies,
-- function bodies, triggers, row-level security, grants) plus the migration ledger.
-- Run it on two databases and compare the rows; any difference names the kind that differs.
-- MAINTAIN (Postgres 17 only) is left out so a Postgres 16 build compares with Neon.
-- Used in Sprint 6 to check Neon against a local build of the same files.
with items as (
  select 'column' k, c.table_schema||'.'||c.table_name||'.'||c.column_name n,
    md5(concat_ws('|', format_type(a.atttypid,a.atttypmod), c.is_nullable, c.column_default, c.ordinal_position)) h
  from information_schema.columns c join pg_attribute a on a.attrelid=(quote_ident(c.table_schema)||'.'||quote_ident(c.table_name))::regclass and a.attname=c.column_name
  where c.table_schema in ('public','auth')
  union all
  select 'constraint', n.nspname||'.'||t.relname||'.'||co.conname, md5(pg_get_constraintdef(co.oid))
  from pg_constraint co join pg_class t on t.oid=co.conrelid join pg_namespace n on n.oid=t.relnamespace where n.nspname in ('public','auth')
  union all
  select 'index', schemaname||'.'||indexname, md5(indexdef) from pg_indexes where schemaname in ('public','auth')
  union all
  select 'policy', schemaname||'.'||tablename||'.'||policyname, md5(concat_ws('|',permissive,array_to_string(roles,','),cmd,qual,with_check)) from pg_policies where schemaname in ('public','auth')
  union all
  select 'function', n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')', md5(pg_get_functiondef(p.oid))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','auth')
  union all
  select 'trigger', n.nspname||'.'||c.relname||'.'||tg.tgname, md5(pg_get_triggerdef(tg.oid))
  from pg_trigger tg join pg_class c on c.oid=tg.tgrelid join pg_namespace n on n.oid=c.relnamespace where not tg.tgisinternal and n.nspname in ('public','auth')
  union all
  select 'rls', n.nspname||'.'||c.relname, md5(c.relrowsecurity::text||c.relforcerowsecurity::text)
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind='r' and n.nspname in ('public','auth')
  union all
  select 'tablegrant', n.nspname||'.'||c.relname, md5(coalesce((select string_agg(case when x.grantee=c.relowner then 'OWNER' when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end||':'||x.privilege_type, ',' order by 1) from aclexplode(c.relacl) x where x.privilege_type<>'MAINTAIN' and (x.grantee=0 or pg_get_userbyid(x.grantee) in ('anon','authenticated') or x.grantee=c.relowner)),''))
  from pg_class c join pg_namespace n on n.oid=c.relnamespace where c.relkind in ('r','v','S') and n.nspname in ('public','auth')
  union all
  select 'colgrant', n.nspname||'.'||c.relname||'.'||a.attname, md5(coalesce((select string_agg(pg_get_userbyid(x.grantee)||':'||x.privilege_type, ',' order by 1) from aclexplode(a.attacl) x where pg_get_userbyid(x.grantee) in ('anon','authenticated')),''))
  from pg_attribute a join pg_class c on c.oid=a.attrelid join pg_namespace n on n.oid=c.relnamespace where a.attacl is not null and n.nspname in ('public','auth')
  union all
  select 'funcgrant', n.nspname||'.'||p.proname||'('||pg_get_function_identity_arguments(p.oid)||')', md5(coalesce((select string_agg(case when x.grantee=0 then 'PUBLIC' else pg_get_userbyid(x.grantee) end||':'||x.privilege_type, ',' order by 1) from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) x where x.grantee=0 or pg_get_userbyid(x.grantee) in ('anon','authenticated')),''))
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname in ('public','auth')
)
select k, count(*) n, md5(string_agg(n||'='||h, ';' order by n)) h from items group by k union all select 'ledger', count(*), md5(string_agg(file_name||'='||sha256, ';' order by file_name)) from public.schema_migrations order by 1;
