-- Longitudinal self-model diffs (I5 / Slice S5)

create table public.self_model_diffs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  from_version_id uuid references public.self_model_versions (id) on delete set null,
  to_version_id uuid not null references public.self_model_versions (id) on delete cascade,
  stable jsonb not null default '[]'::jsonb,
  emerging jsonb not null default '[]'::jsonb,
  fading jsonb not null default '[]'::jsonb,
  environment_shifts jsonb not null default '[]'::jsonb,
  confirmed_predictions jsonb not null default '[]'::jsonb,
  disproved_predictions jsonb not null default '[]'::jsonb,
  event_anchors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);

create index self_model_diffs_owner_created_idx
  on public.self_model_diffs (owner_id, created_at desc);

do $$
begin
  if exists (select 1 from pg_roles where rolname = 'cortex_mirror') then
    grant select, insert on public.self_model_diffs to cortex_mirror;
  end if;
end
$$;
