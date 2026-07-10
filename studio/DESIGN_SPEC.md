# Studio v2 — "Inspection Console" Design Spec

The visual language of EroHub Studio is a **computer-vision inspection instrument**:
precise, data-dense, hairline-ruled, monospaced where it counts. This file is the
contract later page-waves follow so the app stays one coherent console.

Foundation lives in: `theme.ts`, `app/globals.css`, `app/layout.tsx` (fonts),
`components/DetectionFrame/*`. Do not fork these — extend them.

---

## Palette

CSS variables are defined in `app/globals.css` and flip automatically with
`[data-mantine-color-scheme='dark']`. **Always use the vars, never raw hex.**

| Token          | Var             | Dark      | Light "Lab" |
| -------------- | --------------- | --------- | ----------- |
| App background | `--bg`          | `#0E1116` | `#F7F8FA`   |
| Surface (card) | `--surface`     | `#171C24` | `#FFFFFF`   |
| Surface raised | `--surface-2`   | `#1F2630` | `#F0F2F5`   |
| Hairline       | `--hairline`    | `#262E3A` | `#E2E6EC`   |
| Text high      | `--text-hi`     | `#E6EAF0` | `#12161C`   |
| Text low       | `--text-lo`     | `#8A94A6` | `#5A6472`   |

- **Primary / interactive:** Cyan `#38BDF8` → Mantine color `cyan`, base at shade 5
  (`cyan.5`, `var(--mantine-color-cyan-5)`). `primaryShade` is `{ light: 6, dark: 5 }`.
- **Surfaces come free:** Mantine's `--mantine-color-body` = surface, the `<body>` bg =
  `--bg`. So plain `<Paper>` / `<Card>` already sit correctly on the page. Add
  `style={{ background: 'var(--surface)' }}` only when you need it explicit.
- `--mantine-color-default-border` is globally remapped to `--hairline`, so every
  `withBorder` component is hairline out of the box.

### Verdict trio (domain signal — functional, not decorative)

| Verdict | CSS var            | Mantine color |
| ------- | ------------------ | ------------- |
| allow   | `--verdict-allow`  | `allow` (`#34D399`) |
| flag    | `--verdict-flag`   | `flag`  (`#FBBF24`) |
| block   | `--verdict-block`  | `block` (`#FB7185`) |

Use these for moderation decisions, score thresholds, and status only — never as
generic accent colors. Available as full Mantine scales (`color="block"`,
`c="flag.6"`) and as CSS vars for dots/bars.

---

## Typography (next/font, wired in `layout.tsx`)

| Role            | Font          | CSS var                  | Weights   |
| --------------- | ------------- | ------------------------ | --------- |
| Display / headings | Space Grotesk | `--font-space-grotesk` | 500–600   |
| UI / body       | Inter         | `--font-inter`           | 400–600   |
| **Data (mono)** | IBM Plex Mono | `--font-plex-mono`       | 400–600   |

Headings use Space Grotesk automatically (`<Title>`, `theme.headings`). Weights are
deliberate: display 500–600, body 400–500, uppercase mono eyebrows 600.

### `.data-mono` — the data typeface rule

Apply `className="data-mono"` (tabular figures, tight tracking) to **everything that
is data, not prose**:

> API keys · scores / confidence · hashes · IDs · request counts · timestamps ·
> labels · verdict names · section eyebrows.

Prose (titles, descriptions, button text, help copy) stays in Inter/Space Grotesk.

---

## Signature — Detection-Bracket (`<DetectionFrame>`)

Four AF-reticle corner brackets that frame an element. **Use sparingly** — it is the
one signature move; overusing it kills it.

Allowed on:
- the **active** sidebar nav item (via `active` prop — corners fade, no layout shift),
- the **hero / primary** card of a page,
- an empty-state focal icon.

Not on: every card, stat tiles, tables, list rows.

```tsx
<DetectionFrame color="var(--mantine-color-cyan-5)" size={16} inset={-4} weight={2}>
  <Paper withBorder p="xl">…hero…</Paper>
</DetectionFrame>
```

Props: `color`, `size` (arm length px), `inset` (px outside the box, negative),
`weight`, `active`. Default color is the cyan accent.

---

## Shape & depth

- **Radius:** small and precise — `sm` = 6px, the theme default. No large playful
  rounding. Pills only for true badges/chips if ever.
- **Depth:** hairline borders (`--hairline`), not heavy shadows. Layer with
  `--bg` → `--surface` → `--surface-2` instead of drop shadows.

---

## Component conventions

- **Cards:** `<Paper withBorder>` on `--surface`. Section title = uppercase 11px,
  `c="dimmed"`, letter-spacing ~0.5.
- **StatCard:** label uppercase 11px dimmed; value in `.data-mono` 26px/600. Delta in
  mono, `allow.6` (up) / `block.6` (down).
- **PageHeader:** Space Grotesk title, hairline bottom rule. Use on every page.
- **Tables:** `highlightOnHover`, hairline row borders (theme default). Put IDs,
  scores, timestamps in `.data-mono`.
- **Buttons/ActionIcons:** radius `sm`, primary = cyan.
- **Nav:** active item = `--surface-2` bg + `cyan.5` text + Detection-Bracket. Section
  headers are `.data-mono` uppercase 10px.

---

## Data fetching — `useAuthQuery`

Replace per-page `useState + useEffect + try/catch` with the shared hook
(`lib/use-auth-query.ts`, built on `authFetch`, no new dependency):

```tsx
const { data, error, isLoading, refetch } = useAuthQuery<UsageStats>('/usage/stats');
// API service instead of auth service:
const det = useAuthQuery<Result>('/detections?limit=50', { base: 'api' });
// gate on a dependency:
useAuthQuery<T>(path, { enabled: !!selectedKey });
```

`path` is relative (prefixed by `AUTH_URL`/`API_URL` via `base`) or an absolute URL.
See `app/page.tsx` for the reference usage.

---

## Quality floor (non-negotiable)

- Responsive down to mobile (SimpleGrid `base: 1`, wrap groups).
- Visible keyboard focus (global `:focus-visible` cyan outline — don't remove it).
- `prefers-reduced-motion` honored globally; keep motion to subtle hover/nav only.
- No gratuitous animation — it reads as AI-generated slop.
