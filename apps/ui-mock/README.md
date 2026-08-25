# Cortex UI mock — data-verse scan

Static monochrome mockup of a Cortex instrument surface, styled after the visual grammar of Ryoji Ikeda’s *data-verse 2*: black field, white linework, fine grids, micro-labels, coordinates, scan lines, and structured overlays. The subject is a stylized cortex/brain scan as computational contour data — not a consumer product shell.

## Open

```bash
# from repo root
npx --yes serve apps/ui-mock -p 4173
# then open http://localhost:4173
```

Or open `index.html` directly in a browser (Google Fonts still load if online).

## Controls

| Input | Action |
|-------|--------|
| Pointer move | Update `XY` readout |
| Click (canvas) | Toggle `AXIAL` ↔ `SAGITTAL` |
| `A` / Space | Toggle plane |
| `]` / ↑ | Next slice |
| `[` / ↓ | Previous slice |
| `ASK_MIRROR` | Hairline control (mock ack only) |

`prefers-reduced-motion: reduce` freezes the raster sweep and slows metadata updates.

## Aesthetic contract

- Black `#000` only; white via opacity hierarchy
- No cards, pills, color accents, or marketing CTAs
- `CORTEX` is a system stamp, co-equal with scan metadata

## Out of scope

Real MCP/API data, auth, Next.js app shell, sound.
