# vite-plugin-slidev-manager

[日本語版 README](docs/ja/README.md)

A Vite plugin for managing multiple Slidev presentations in a monorepo.

## Features

- Presentation selector for `dev`, `build`, and `export:browser`
- Supports both workspace and non-workspace presentation layouts
- In-page deck switching UI for Slidev decks
- Slidev CLI argument passthrough

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
import { defineConfig } from 'vite';
import presentationManager from 'vite-plugin-slidev-manager';

export default defineConfig({
    plugins: [
        presentationManager({
            presentationsDir: 'presentations',
        }),
    ],
});
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
    - creates `custom-nav-controls.vue` in the active deck only while the dev bridge is running, then removes it on shutdown
- `npm run build`
    - opens the selector
    - runs the `build` script for the selected presentation
- `npm run export:browser`
    - opens the selector
    - opens the selected deck's `/export` page in the browser

### 4. Pass Slidev options

Pass Slidev CLI options after `--`.

```bash
npm run dev -- -- --port 3030
npm run build -- -- --base /deck/ --output dist/slides
npm run export:browser -- -- --export --port 3030
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

## Generated files during dev

During `dev`, the plugin temporarily creates a navigation control file only in the active presentation directory:

```text
<vite-root>/
└── presentations/
  └── <active-deck>/
    └── custom-nav-controls.vue
```

This file is used to provide navigation controls for deck switching, and it is removed when the dev bridge stops.

## Options

```ts
presentationManager({
    presentationsDir: 'presentations',
});
```

- `presentationsDir`: directory to scan for presentations. Default: `presentations`
    - relative paths are resolved from the Vite root

Other options exist for advanced or custom setups, but most users only need `presentationsDir`.

## Directory layout notes

This plugin does not require a VS Code workspace-specific layout.
It works with a regular directory structure as long as:

- Vite can start from the intended project root
- `presentationsDir` points to your presentation folders, relative to the Vite root or as an absolute path
- `@slidev/cli` is resolvable from the project where the plugin runs

This repository includes verified sample layouts under `fixture/`.

- `fixture/normal`: regular directory layout without workspaces
- `fixture/workspace`: monorepo-style layout with workspaces and shared themes

See `fixture/README.md` for setup and run instructions.

## Development

```bash
bun install
bun run test
bun run lint
bun run build
```
