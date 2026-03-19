# vite-plugin-slidev-manager

A Vite plugin for managing multiple Slidev presentations in a monorepo structure. It provides an interactive CLI to select a presentation and then runs the matching Slidev command.

## Features

- **Interactive CLI**: Uses [Ink](https://github.com/vadimdemedes/ink) to provide a terminal selector.
- **Presentation-aware commands**: Launches either direct `slidev` commands or the selected presentation's `dev` / `build` / `export` workspace scripts.
- **In-page dev switcher**: In dev mode, decks with a `slides.md` get an on-page switcher rendered through Slidev's global layer hook.
- **Option passthrough**: Forward Slidev CLI flags such as `--port`, `--base`, or `--output` via `bun run ... -- ...`.
- **Monorepo support**: Automatically discovers presentations in a `presentations` directory.
- **Custom directory support**: `presentationsDir` can point to another folder.

## Requirements

- `bun` `1.3.10` or later for local development in this repository
- `vite` `^5 || ^6 || ^7 || ^8`
- `@slidev/cli` `>=52.14.1`
- Node.js version supported by your installed Vite and Slidev versions

## Installation

```bash
bun add -d vite-plugin-slidev-manager vite @slidev/cli
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
            defaultBuildCommand: 'build',
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
        "export": "vite build -- export"
    }
}
```

`vite-plugin-slidev-manager` intercepts `vite` / `vite build`, shows the presentation selector, and then hands off execution to either Slidev directly or the selected presentation's workspace script.

### 3. Run commands

- `bun run dev`
    - Opens the selector, starts either the selected presentation's `dev` flow behind a stable local proxy URL, and injects an in-page deck switcher when the selected presentation has a `slides.md`
- `bun run build`
    - Opens the selector and starts either `slidev build [entry]` or the selected presentation's `build` script
- `bun run export`
    - Opens the selector and starts either `slidev export [entry] --timeout 60000 --wait-until domcontentloaded` or the selected presentation's `export` script

### 4. Pass Slidev options

Pass extra Slidev CLI options after `--`.

```bash
bun run dev -- -- --port 3030
bun run build -- -- --out dist/slides --base /deck/
bun run export -- -- export --output docs/deck.pdf
```

The first argument after `--` can optionally switch the Slidev subcommand to `dev`, `build`, or `export`. This is mainly useful when reusing the same Vite script.

You can also define default Slidev arguments in plugin options:

```ts
presentationManager({
    devArgs: ['--remote', 'secret'],
    buildArgs: ['--out', 'dist/slides'],
    exportArgs: ['--output', 'slides.pdf'],
    defaultBuildCommand: 'export',
});
```

CLI-passed arguments are appended after configured defaults so Slidev resolves them with normal CLI precedence.

### 5. Dev switcher behavior

When you launch `bun run dev`, the plugin runs the selected presentation behind a small local supervisor and a stable local proxy URL.

- The terminal selector still chooses the initial deck.
- If the selected presentation has a `slides.md`, the plugin generates a temporary `.slidev-manager/` support directory next to that deck.
- It also writes a temporary `custom-nav-controls.vue` file so Slidev can expose the deck-switching UI in nav controls.
- The browser stays on a stable public URL while the supervisor swaps the upstream dev server behind the proxy.
- Choosing another deck from the browser still triggers a **full dev-server relaunch** for the new deck. This is not an in-app hot swap.

Notes and limitations:

- Deck switching UI only appears for decks that expose a `slides.md`, because the generated overlay files are injected into that deck root.
- Workspace-script presentations without a `slides.md` can still be selected and launched, but they do not get the injected switcher UI.
- If only one dev-capable deck with `slides.md` is available, the generated overlay stays hidden.
- Existing `custom-nav-controls.vue` content is backed up while the dev session is running and restored when the supervisor exits cleanly.
- Forwarded Slidev flags such as `--port`, `--open`, and `--base` continue to apply. During dev, the public `--port` belongs to the proxy and each upstream Slidev process receives an internal port.

## Directory structure

The plugin expects each presentation directory to contain either:

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

When `slides.md` exists, the presentation is available for all three direct Slidev commands. When only `package.json` exists, availability is inferred from the `dev` / `build` / `export` scripts present in that package, and those scripts are executed with the presentation directory as the working directory.

## Development

This repository uses Bun for dependency installation and script execution.

```bash
bun install
bun run lint
bun run lint:fix
bun run format
bun run format:write
bun run test
bun run build
```

## Troubleshooting

At the moment, dependency audit noise is more likely to come from Slidev's transitive `dompurify` chain than from `monaco-editor` version resolution. A local `monaco-editor` override is not required for this repository's current dependency graph.
