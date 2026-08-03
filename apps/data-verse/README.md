# Cortex data-verse (rollback copy)

Ikeda-style visualization frontend for Cortex, deployed to Railway without a login gate.

**This is not where UI changes go.** The primary frontend is
[`jackye426/data-verse-render`](https://github.com/jackye426/data-verse-render) (Lovable →
private `jackye.wiki`), cloned locally at `../data-verse-render-backup`. Keep this copy building
so it stays usable as a fallback; author features upstream. Full topology:
[docs/data-verse.md](../../docs/data-verse.md).

```sh
pnpm --filter @cortex/data-verse dev
```

Default: fixture mode (`VITE_VIZ_FIXTURES=1` or unset API URL). Live mode:

```sh
VITE_VIZ_API_URL=http://localhost:8790 VITE_VIZ_BEARER=<token> pnpm --filter @cortex/data-verse dev
```
