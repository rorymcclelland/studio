-- F-11: kit context items are keyed by their own text, not their position, so
-- deleting or reordering a rule leaves every other rule's key (and id) alone.
-- Must match normaliseKitText/textKey in src/lib/context/keys.ts.

create function public.kit_text_key(t text) returns text
language sql immutable set search_path = '' as $$
  -- ASCII-only case folding and whitespace, so the result never depends on the
  -- database's collation.
  select left(md5(translate(
    regexp_replace(regexp_replace(t, '^[ \t\r\n\f\v]+|[ \t\r\n\f\v]+$', '', 'g'), '[ \t\r\n\f\v]+', ' ', 'g'),
    'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz')), 12)
$$;

-- If a kit held the same rule twice, keep the first item and drop the rest.
-- The positional items are picked out first (materialised), so the position
-- is only ever cast for keys that really are positional.
with positional as materialized (
  select id, brand_id, split_part(source_ref, ':', 1) || ':' || split_part(source_ref, ':', 2) as list,
         split_part(source_ref, ':', 3)::int as pos, public.kit_text_key(body) as k
  from public.context_items
  where created_by_kind = 'system' and source_ref ~ '^(rule:do|rule:dont|legal:line):[0-9]{1,4}$'
), ranked as (
  select id, row_number() over (partition by brand_id, list, k order by pos) as n from positional
)
delete from public.context_items c using ranked r where c.id = r.id and r.n > 1;

update public.context_items
set source_ref = split_part(source_ref, ':', 1) || ':' || split_part(source_ref, ':', 2) || ':' || public.kit_text_key(body)
where created_by_kind = 'system'
  and source_ref ~ '^(rule:do|rule:dont|legal:line):[0-9]{1,4}$';
