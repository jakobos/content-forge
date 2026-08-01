# shadcn/ui Ocean Breeze Theme Reference

> Source: https://www.shadcn.io/theme/ocean-breeze (shadcn.io community site, not official shadcn/ui)

## Description

Calm coastal theme with sea blues and sandy neutrals. Captures the restorative quality of coastal mornings -- temperate coast, not tropical.

Suggested use cases: beach resort / coastal property sites, wellness / meditation platforms, sailing / maritime brands, coastal lifestyle / home decor, spa / relaxation services.

## Key Color Values (from description)

| Color Role                | OKLCH Value            | Description                                |
| ------------------------- | ---------------------- | ------------------------------------------ |
| Sea blue (primary)        | `oklch(0.72 0.10 230)` | Gentle sea blue that calms without cooling |
| Sandy neutral (secondary) | `oklch(0.88 0.04 80)`  | Warm neutral, like beach at dawn           |
| Morning mist (accent)     | `oklch(0.75 0.05 240)` | Soft blue-gray of morning mist             |

## Installation (requires shadcn.io Pro)

```bash
npx shadcn@latest add https://www.shadcn.io/r/ocean-breeze.json
```

> **Note:** The JSON registry endpoint (`https://www.shadcn.io/r/ocean-breeze.json`) returns HTTP 401 without a Pro subscription. The full CSS variable definitions are not publicly available.

## Manual Theme Construction

Since the full CSS is paywalled, a theme can be constructed manually using the three reference colors above mapped to shadcn/ui semantic tokens. The pattern follows the standard shadcn theming approach:

```css
/* Approximate Ocean Breeze palette -- derived from description, not official */
:root {
  --radius: 0.625rem;
  --background: oklch(0.98 0.01 230); /* Very light sea-tinted white */
  --foreground: oklch(0.25 0.03 230); /* Dark ocean blue-gray */
  --card: oklch(0.97 0.01 80); /* Sandy off-white */
  --card-foreground: oklch(0.25 0.03 230);
  --popover: oklch(0.98 0.01 230);
  --popover-foreground: oklch(0.25 0.03 230);
  --primary: oklch(0.72 0.1 230); /* Sea blue */
  --primary-foreground: oklch(0.98 0.01 230);
  --secondary: oklch(0.88 0.04 80); /* Sandy neutral */
  --secondary-foreground: oklch(0.25 0.03 230);
  --muted: oklch(0.93 0.02 80); /* Light sand */
  --muted-foreground: oklch(0.5 0.03 230);
  --accent: oklch(0.75 0.05 240); /* Morning mist */
  --accent-foreground: oklch(0.25 0.03 230);
  --destructive: oklch(0.577 0.245 27.325);
  --border: oklch(0.9 0.02 230);
  --input: oklch(0.9 0.02 230);
  --ring: oklch(0.72 0.1 230);
}

.dark {
  --background: oklch(0.18 0.03 230); /* Deep ocean */
  --foreground: oklch(0.93 0.02 230); /* Light sea foam */
  --card: oklch(0.22 0.03 230);
  --card-foreground: oklch(0.93 0.02 230);
  --popover: oklch(0.22 0.03 230);
  --popover-foreground: oklch(0.93 0.02 230);
  --primary: oklch(0.72 0.1 230); /* Sea blue */
  --primary-foreground: oklch(0.18 0.03 230);
  --secondary: oklch(0.3 0.03 80); /* Dark sand */
  --secondary-foreground: oklch(0.93 0.02 230);
  --muted: oklch(0.28 0.02 230);
  --muted-foreground: oklch(0.65 0.04 230);
  --accent: oklch(0.75 0.05 240); /* Morning mist */
  --accent-foreground: oklch(0.93 0.02 230);
  --destructive: oklch(0.704 0.191 22.216);
  --border: oklch(1 0 0 / 10%);
  --input: oklch(1 0 0 / 15%);
  --ring: oklch(0.72 0.1 230);
}
```

**Important:** These values are approximations derived from the theme description, not the official Ocean Breeze CSS. The actual theme may differ. If exact fidelity is required, a Pro subscription at https://www.shadcn.io/pricing is needed.

## How shadcn Theming Works

shadcn/ui uses semantic CSS variables in OKLCH format. Components reference tokens like `bg-primary`, `text-muted-foreground` via Tailwind utilities. Changing the CSS variables changes all components automatically.

### Token Reference

| Token                                    | Purpose                          |
| ---------------------------------------- | -------------------------------- |
| `--background` / `--foreground`          | Page background and default text |
| `--card` / `--card-foreground`           | Card surfaces                    |
| `--primary` / `--primary-foreground`     | Primary buttons and actions      |
| `--secondary` / `--secondary-foreground` | Secondary actions                |
| `--muted` / `--muted-foreground`         | Muted/disabled states            |
| `--accent` / `--accent-foreground`       | Hover and accent states          |
| `--destructive`                          | Error and destructive actions    |
| `--border`                               | Default border color             |
| `--input`                                | Form input borders               |
| `--ring`                                 | Focus ring color                 |
| `--chart-1` through `--chart-5`          | Chart/data visualization         |
| `--sidebar-*`                            | Sidebar-specific colors          |

### Integration with Tailwind v4 (this project's setup)

Tokens are bridged to Tailwind via `@theme inline` in `src/styles/global.css`:

```css
@theme inline {
  --color-background: var(--background);
  --color-foreground: var(--foreground);
  --color-primary: var(--primary);
  --color-primary-foreground: var(--primary-foreground);
  /* ... all other tokens ... */
}
```

This enables utilities like `bg-primary`, `text-muted-foreground`, `border-border` etc.
