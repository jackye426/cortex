-- Mirror privilege: evidence capabilities table + sanitised calendar view.
-- Mirror agents should prefer the view / broker RPCs over raw records SELECT.

create table if not exists public.evidence_capabilities (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid,
  class text not null check (class in ('sensitive', 'restricted')),
  purpose text not null,
  source_types text[] not null default '{}',
  date_since timestamptz not null,
  date_until timestamptz not null,
  subject_ids text[] not null default '{}',
  max_results int not null default 5,
  permitted_fields text[] not null default '{}',
  issued_by text not null check (issued_by in ('mirror', 'ops')),
  uses_remaining int not null default 1,
  expires_at timestamptz not null,
  token_id_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists evidence_capabilities_expires_idx
  on public.evidence_capabilities (expires_at);

alter table public.evidence_capabilities enable row level security;

drop policy if exists evidence_capabilities_all on public.evidence_capabilities;
create policy evidence_capabilities_all on public.evidence_capabilities
  for all using (true) with check (true);

comment on table public.evidence_capabilities is
  'Short-lived scoped capabilities for evidence broker (sensitive/restricted).';

-- Sanitised calendar structure (no description / conference secrets).
create or replace view public.cortex_calendar_structure as
select
  r.id,
  r.owner_id,
  r.source_record_id,
  nullif(r.payload->>'summary', '') as summary,
  coalesce(nullif(r.payload->>'start', ''), r.occurred_at::text) as start_at,
  nullif(r.payload->>'end', '') as end_at,
  case
    when jsonb_typeof(r.payload->'attendees') = 'array'
      then jsonb_array_length(r.payload->'attendees')
    when (r.payload ? 'attendeeCount')
      then coalesce((r.payload->>'attendeeCount')::int, 0)
    else 0
  end as attendee_count,
  coalesce(length(nullif(r.payload->>'description', '')) > 0, false) as has_description,
  coalesce(
    jsonb_typeof(r.payload->'attachments') = 'array'
      and jsonb_array_length(r.payload->'attachments') > 0,
    false
  ) as has_attachments,
  r.occurred_at
from public.records r
where r.record_type = 'calendar_event';

comment on view public.cortex_calendar_structure is
  'Mirror-safe calendar fields: summary/start/end/attendee_count only.';
