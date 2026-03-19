# vite-plugin-slidev-manager

A Vite plugin for managing multiple Slidev presentations in a monorepo. It shows a presentation selector before `vite` / `vite build`, launches the selected deck, and provides a stable bridge URL for dev-time deck switching.

## Features

- Presentation selector for `dev`, `build`, and browser export flows
- Monorepo-aware execution for `slides.md` decks and workspace-script decks
- Stable dev bridge with in-page deck switching UI for Slidev decks
- Safe behavior in non-interactive environments
- Slidev CLI argument passthrough
- Custom `presentationsDir` support

## Requirements

- Node.js version supported by your installed Vite and Slidev versions
- `vite` `^5 || ^6 || ^7 || ^8`
- `@slidev/cli` `>=52.14.1`

## Installation

```bash
npm install -D vite-plugin-slidev-manager vite @slidev/cli
```

## Usage

### 1. Configure Vite

```ts
import { defineConfig } from 'vite'
import presentationManager from 'vite-plugin-slidev-manager'

export default defineConfig({
  plugins: [
    presentationManager({
      presentationsDir: 'presentations',
      defaultBuildCommand: 'build',
    }),
  ],
})
```

### 2. Add scripts

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "export:browser": "vite -- --export"
  }
}
```

Use `vite -- --export` instead of `vite export`.
`vite export` is not a standard Vite command, and this plugin uses the forwarded `--export` flag to switch into browser-export mode.

### 3. Run commands

```bash
npm run dev
npm run build
npm run export:browser
```

- `npm run dev`
  - opens the selector
  - starts the selected deck behind a stable bridge URL
  - injects the in-page switcher for decks with `slides.md`
- `npm run build`
  - opens the selector
  - runs `slidev build` or the selected workspace `build` script
- `npm run export:browser`
  - opens the selector
  - starts the dev bridge
  - opens the selected deck's `/export` page in the browser

### 4. Pass Slidev options

Pass Slidev CLI options after `--`.

```bash
npm run dev -- -- --port 3030
npm run build -- -- --base /deck/ --output dist/slides
npm run export:browser -- -- --export --port 3030
```

You can also define default Slidev arguments in plugin options:

```ts
presentationManager({
  devArgs: ['--remote', 'secret'],
  buildArgs: ['--base', '/deck/'],
  exportArgs: ['--output', 'slides.pdf'],
  defaultBuildCommand: 'build',
})
```

## Non-interactive environments

When no TTY is available, the plugin does not render the Ink selector.
Set the target deck explicitly instead:

```bash
SLIDEV_MANAGER_PRESENTATION=minimal-demo npm run build
SLIDEV_MANAGER_PRESENTATION=minimal-demo npm run export:browser
```

## Expected presentation structure

Each presentation directory should contain either:

- a `slides.md`, or
- a `package.json` with `dev`, `build`, and/or `export` scripts

```text
my-project/
├── package.json
├── vite.config.ts
└── presentations/
    ├── intro/
    │   └── slides.md
    └── advanced/
        ├── package.json
        └── slides.md
```

When `slides.md` exists, the presentation is available for direct Slidev `dev` / `build` / `export` flows. When only `package.json` exists, availability is inferred from the scripts present in that package.

## Options

```ts
presentationManager({
  presentationsDir: 'presentations',
  defaultBuildCommand: 'build',
  devArgs: [],
  buildArgs: [],
  exportArgs: [],
})
```

- `presentationsDir`: directory to scan for presentations. Default: `presentations`
- `defaultBuildCommand`: action used when `vite build` runs without an explicit forwarded subcommand
- `devArgs`, `buildArgs`, `exportArgs`: default Slidev arguments appended before user-provided CLI arguments

## Troubleshooting

### The selector does not appear

- In a non-interactive shell, set `SLIDEV_MANAGER_PRESENTATION=<folder>`.
- For browser export, use `npm run export:browser`, not `vite export`.

### `POST /__bridge/switch ... 404 Not Found`

This usually means port `3030` is being served by a regular Vite / Slidev process instead of the manager bridge.

```bash
pkill -f "slidev.mjs"
pkill -f "/slides/node_modules/.bin/vite"
```

Then restart from the Slidev monorepo root and verify:

```bash
curl http://localhost:3030/__bridge/presentations
```

If the bridge is active, that endpoint returns JSON.

### `Unknown arguments: timeout, wait-until`

Update to a version that strips export-only flags before launching the dev server for browser export.

## Development

```bash
bun install
bun run test
bun run lint
bun run build
```
