-- S2-2: brands and their catalogue (products, simulated customers and orders).
-- Rule 7: every table carries workspace_id with row-level security. Child rows
-- reference their parent by (id, workspace_id), so a row can only ever belong to
-- a brand, customer, order or product in its own workspace.
-- Customers carry no personal data by design: no names, emails or addresses.

create table public.brands (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.workspaces (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 80),
  slug text not null check (char_length(slug) <= 40 and slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  description text not null default '' check (char_length(description) <= 500),
  category text not null default '' check (char_length(category) <= 60),
  tone_words text[] not null default '{}' check (cardinality(tone_words) <= 12),
  voice_notes text not null default '' check (char_length(voice_notes) <= 2000),
  do_rules text[] not null default '{}' check (cardinality(do_rules) <= 20),
  dont_rules text[] not null default '{}' check (cardinality(dont_rules) <= 20),
  palette jsonb not null default '[]' check (jsonb_typeof(palette) = 'array' and jsonb_array_length(palette) <= 12),
  font_primary text not null default '' check (char_length(font_primary) <= 60),
  font_secondary text not null default '' check (char_length(font_secondary) <= 60),
  logo_svg text check (logo_svg is null or char_length(logo_svg) <= 50000),
  legal_lines text[] not null default '{}' check (cardinality(legal_lines) <= 20),
  banned_terms text[] not null default '{}' check (cardinality(banned_terms) <= 50),
  evidence_claims text[] not null default '{}' check (cardinality(evidence_claims) <= 20),
  is_simulated boolean not null default false,
  created_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (workspace_id, slug),
  unique (id, workspace_id)
);

create index brands_created_by_idx on public.brands (created_by);

create trigger brands_touch before update on public.brands
for each row execute function public.touch_updated_at();

create table public.products (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  brand_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 120),
  category text not null default '' check (char_length(category) <= 60),
  price_pence integer not null check (price_pence >= 0),
  description text not null default '' check (char_length(description) <= 1000),
  launched_on date,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  foreign key (brand_id, workspace_id) references public.brands (id, workspace_id) on delete cascade
);

create index products_brand_idx on public.products (brand_id, workspace_id);

create table public.customers (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  brand_id uuid not null,
  external_ref text not null check (char_length(external_ref) between 1 and 40),
  region text not null default '' check (char_length(region) <= 60),
  age_band text not null default '' check (char_length(age_band) <= 20),
  first_order_on date,
  marketing_consent boolean not null default false,
  created_at timestamptz not null default now(),
  unique (id, workspace_id),
  unique (brand_id, external_ref),
  foreign key (brand_id, workspace_id) references public.brands (id, workspace_id) on delete cascade
);

create index customers_brand_idx on public.customers (brand_id, workspace_id);

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  brand_id uuid not null,
  customer_id uuid not null,
  ordered_at timestamptz not null,
  channel text not null check (channel in ('web', 'app', 'store', 'marketplace')),
  unique (id, workspace_id),
  foreign key (brand_id, workspace_id) references public.brands (id, workspace_id) on delete cascade,
  foreign key (customer_id, workspace_id) references public.customers (id, workspace_id) on delete cascade
);

create index orders_brand_idx on public.orders (brand_id, workspace_id, ordered_at);
create index orders_customer_idx on public.orders (customer_id, workspace_id);

create table public.order_lines (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null,
  order_id uuid not null,
  product_id uuid not null,
  quantity integer not null check (quantity between 1 and 1000),
  price_pence integer not null check (price_pence >= 0),
  foreign key (order_id, workspace_id) references public.orders (id, workspace_id) on delete cascade,
  foreign key (product_id, workspace_id) references public.products (id, workspace_id) on delete cascade
);

create index order_lines_order_idx on public.order_lines (order_id, workspace_id);
create index order_lines_product_idx on public.order_lines (product_id, workspace_id);

-- Row-level security: members of the workspace may read and write its rows.

alter table public.brands enable row level security;
alter table public.products enable row level security;
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_lines enable row level security;

create policy brands_select on public.brands for select to authenticated using (public.is_member(workspace_id));
create policy brands_insert on public.brands for insert to authenticated
  with check (public.is_member(workspace_id) and created_by = (select auth.uid()));
create policy brands_update on public.brands for update to authenticated
  using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
create policy brands_delete on public.brands for delete to authenticated using (public.is_member(workspace_id));

create policy products_all on public.products for all to authenticated
  using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
create policy customers_all on public.customers for all to authenticated
  using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
create policy orders_all on public.orders for all to authenticated
  using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));
create policy order_lines_all on public.order_lines for all to authenticated
  using (public.is_member(workspace_id)) with check (public.is_member(workspace_id));

-- Nothing for anon.
revoke all on public.brands, public.products, public.customers, public.orders, public.order_lines from anon;
