# vite-plugin-slidev-manager

A Vite plugin for managing multiple Slidev presentations in a monorepo structure. It provides an interactive CLI to select and launch presentations for development or export.

## Features

- **Interactive CLI**: Uses [Ink](https://github.com/vadimdemedes/ink) to provide a user-friendly terminal interface.
- **Monorepo Support**: Automatically discovers presentations in a `presentations` directory.
- **Dev & Export Modes**:
  - **Dev**: Select a presentation to start the Slidev development server (`slidev`).
  - **Build**: Select a presentation to export as PDF (`slidev export`).
- **Seamless Integration**: Hooks directly into Vite's `configureServer` and `buildStart` lifecycles.

## Installation

```bash
npm install -D vite-plugin-slidev-manager
# or
yarn add -D vite-plugin-slidev-manager
# or
pnpm add -D vite-plugin-slidev-manager
```

## Usage

### 1. Configure Vite

Add the plugin to your `vite.config.ts` (or `vite.config.mts`):

```typescript
import { defineConfig } from 'vite';
import presentationManager from 'vite-plugin-slidev-manager';

export default defineConfig({
  plugins: [
    presentationManager({
      presentationsDir: 'my-presentations' // Optional: default is 'presentations'
    })
  ]
});
```

### 2. Add Scripts

In your root `package.json`, set up the scripts to trigger Vite:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build"
  }
}
```

### 3. Run

- **Development**: Run `npm run dev`. You will see a list of presentations. Select one to start editing.
- **Export**: Run `npm run build`. You will see a list of presentations. Select one to build/export (currently PDF only).

## Directory Structure

The plugin expects a `presentations` directory in the root of your project. Each subdirectory should contain a Slidev presentation (either a `slides.md` file or a `package.json` defining a workspace).

```
my-project/
├── package.json
├── vite.config.ts
├── presentations/
│   ├── my-presentation-1/
│   │   └── slides.md
│   └── my-presentation-2/
│       └── slides.md
```
