# Fixture Samples

This directory contains two runnable sample projects for vite-plugin-slidev-manager.

## normal

- Regular directory layout without npm workspaces
- Presentations are plain slides.md decks under presentations/
- Good for checking that relative presentationsDir resolution works from the Vite root

## workspace

- Monorepo-style sample using npm workspaces
- Includes shared Slidev themes under themes/
- Useful for checking workspace-script decks and direct slides.md decks together

## How to try them

With bun, register the plugin from the repository root first:

```bash
bun link
```

Then from either sample directory:

```bash
bun install
bun run dev
```

The fixture package.json files use bun's local link dependency for vite-plugin-slidev-manager.
