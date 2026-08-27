# Company Brain provisioning

Infra runbook for V0: reuse an existing Supabase project (typically the Cortex
EU project), add namespaced `cb_*` tables, and register the GitHub App.

## Isolation model (locked)

| Layer | Rule |
|---|---|
| Physical project | May **reuse** the existing Cortex Supabase project — do not create a second project unless Jack asks |
| Schema | Company Brain owns `public.cb_*` + `company_brain_private.*` only |
| Runtime credentials | **Only** `COMPANY_BRAIN_*` — never fall back to `SUPABASE_*` / `CORTEX_*` |
| Records | Empty store after migrate; no Cortex/gbrain row import |

## 1. Apply migrations to the existing project

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → the existing EU Cortex project.
2. Copy **Database → Connection string (URI)** into `COMPANY_BRAIN_DATABASE_URL` (do not commit).
3. Apply in order:

```bash
COMPANY_BRAIN_DATABASE_URL='postgresql://postgres:<PASSWORD>@db.<PROJECT_REF>.supabase.co:5432/postgres' \
  node scripts/company-brain-apply-migrations.mjs
```

Or paste `apps/company-brain/migrations/001_init.sql` then
`002_integrity_hardening.sql` into **SQL Editor**.

Smoke:

```sql
select id, kind from public.cb_actors order by id;
select count(*) from public.cb_source_events;
```

Expect actors `agent`, `eric`, `ingest`, `jack` and zero source events.

4. Wire runtime (values may match Cortex’s project, but **must** use Company Brain names):

```bash
COMPANY_BRAIN_STORE=supabase
COMPANY_BRAIN_SUPABASE_URL=https://<PROJECT_REF>.supabase.co
COMPANY_BRAIN_SUPABASE_SERVICE_ROLE_KEY=<service_role — paste into this name>
COMPANY_BRAIN_SUPABASE_PROJECT_REF=<PROJECT_REF>
COMPANY_BRAIN_CUTOVER_AT=2026-08-01T00:00:00Z
```

## 2. Deploy webhook host

The GitHub App needs a public HTTPS origin for
`POST /v1/webhooks/github`. Deploy `apps/company-brain` (Railway service
suggested) and set `COMPANY_BRAIN_PUBLIC_URL` to that origin.

## 3. Register the GitHub App

Cloud/agent tokens cannot create GitHub Apps. Generate a one-click manifest:

```bash
COMPANY_BRAIN_PUBLIC_URL=https://<company-brain-host> \
  node scripts/company-brain-github-app-manifest.mjs
```

Open `apps/company-brain/github-app-manifest.html`, click **Create GitHub App**,
then **Install** on allowlisted Forma repos only.

Set:

| Variable | Source |
|---|---|
| `COMPANY_BRAIN_GITHUB_WEBHOOK_SECRET` | App → Webhook secret (≥32 bytes, ≥12 distinct chars) |
| `COMPANY_BRAIN_GITHUB_INSTALLATION_IDS` | Installation ID after install |
| `COMPANY_BRAIN_GITHUB_ALLOWED_REPOS` | `owner/name` allowlist |
| Bearer tokens | Generate unique ≥32-byte secrets for ingest / agent / Jack / Eric |

Permissions (manifest): read `contents`, `issues`, `pull_requests`, `checks`,
`actions`, `deployments`, `metadata`.

Events: `pull_request`, `pull_request_review`, `issues`, `check_run`,
`check_suite`, `workflow_run`, `deployment`, `deployment_status`.

## 4. Smoke

```bash
curl -sS "$COMPANY_BRAIN_PUBLIC_URL/health"
# Post a signed test delivery or redeliver a real PR event from the App’s
# Advanced → Recent Deliveries once the service is live.
```

Acceptance for this slice: a post-cutover GitHub event on an allowlisted repo
produces a `cb_source_events` row and a cited hard-fact or observation path.
