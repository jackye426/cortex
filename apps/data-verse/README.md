# Cortex data-verse

Ikeda-style visualization frontend for Cortex.

Backup of the Lovable upstream lives at `../data-verse-render-backup` (sibling of the Cortex repo).

```sh
pnpm --filter @cortex/data-verse dev
```

Default: fixture mode (`VITE_VIZ_FIXTURES=1` or unset API URL). Live mode:

```sh
VITE_VIZ_API_URL=http://localhost:8790 VITE_VIZ_BEARER=<token> pnpm --filter @cortex/data-verse dev
```

See [docs/data-verse.md](../../docs/data-verse.md).
