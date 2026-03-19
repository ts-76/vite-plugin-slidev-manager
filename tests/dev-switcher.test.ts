import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    buildSupportDirPath,
    cleanDevSwitcherFiles,
    generateDevSwitcherFiles,
    SUPPORT_DIR_NAME,
    type DevSwitcherManifest,
} from '../src/bridge/dev-switcher.js';
import type { DeckEntry } from '../src/bridge/generated-switcher-template.js';

const TEST_ROOT = path.join(import.meta.dirname, '..', '.test-tmp-dev-switcher');

const DECKS: DeckEntry[] = [
    {
        folder: 'intro',
        label: 'Intro (presentations/intro/slides.md)',
        slug: 'intro',
        title: 'Intro',
        detail: 'presentations/intro/slides.md',
    },
    {
        folder: 'advanced',
        label: 'Advanced (presentations/advanced/slides.md)',
        slug: 'advanced',
        title: 'Advanced',
        detail: 'presentations/advanced/slides.md',
    },
];

const FIXED_DATE = new Date('2025-01-15T12:00:00.000Z');

describe('buildSupportDirPath', () => {
    it('joins the deck root with the support directory name', () => {
        expect(buildSupportDirPath('/decks/intro')).toBe(
            path.join('/decks/intro', SUPPORT_DIR_NAME),
        );
    });
});

describe('generateDevSwitcherFiles', () => {
    let deckRoot: string;

    beforeEach(async () => {
        deckRoot = path.join(TEST_ROOT, `deck-${Date.now()}`);
        await fs.mkdir(deckRoot, { recursive: true });
    });

    afterEach(async () => {
        await fs.rm(TEST_ROOT, { recursive: true, force: true });
    });

    it('creates the support directory', async () => {
        const result = await generateDevSwitcherFiles({
            deckRoot,
            decks: DECKS,
            currentSlug: 'intro',
            bridgeUrl: 'http://localhost:3000/__bridge',
            now: FIXED_DATE,
        });

        const stat = await fs.stat(result.supportDir);
        expect(stat.isDirectory()).toBe(true);
        expect(result.supportDir).toBe(path.join(deckRoot, SUPPORT_DIR_NAME));
    });

    it('writes a valid JSON manifest with all deck entries', async () => {
        const result = await generateDevSwitcherFiles({
            deckRoot,
            decks: DECKS,
            currentSlug: 'intro',
            bridgeUrl: 'http://localhost:3000/__bridge',
            now: FIXED_DATE,
        });

        const raw = await fs.readFile(result.manifestPath, 'utf8');
        const manifest: DevSwitcherManifest = JSON.parse(raw);

        expect(manifest.generatedAt).toBe('2025-01-15T12:00:00.000Z');
        expect(manifest.currentSlug).toBe('intro');
        expect(manifest.bridgeUrl).toBe('http://localhost:3000/__bridge');
        expect(manifest.decks).toEqual(DECKS);
    });

    it('writes custom-nav-controls.vue in the deck root', async () => {
        const result = await generateDevSwitcherFiles({
            deckRoot,
            decks: DECKS,
            currentSlug: 'advanced',
            bridgeUrl: 'http://localhost:3000/__bridge',
            now: FIXED_DATE,
        });

        expect(result.navControlsPath).toBe(path.join(deckRoot, 'custom-nav-controls.vue'));

        const content = await fs.readFile(result.navControlsPath, 'utf8');
        expect(content).toContain('<template>');
        expect(content).toContain('method="POST"');
        expect(content).toContain('formaction="http://localhost:3000/__bridge/switch?folder=intro"');
        expect(content).toContain(
            'formaction="http://localhost:3000/__bridge/switch?folder=advanced"',
        );
        expect(content).toContain('smgr-item--active');
    });

    it('produces deterministic output for the same input', async () => {
        const opts = {
            deckRoot,
            decks: DECKS,
            currentSlug: 'intro',
            bridgeUrl: 'http://localhost:3000/__bridge',
            now: FIXED_DATE,
        };

        const result1 = await generateDevSwitcherFiles(opts);
        const manifest1 = await fs.readFile(result1.manifestPath, 'utf8');
        const navControls1 = await fs.readFile(result1.navControlsPath, 'utf8');

        const result2 = await generateDevSwitcherFiles(opts);
        const manifest2 = await fs.readFile(result2.manifestPath, 'utf8');
        const navControls2 = await fs.readFile(result2.navControlsPath, 'utf8');

        expect(manifest1).toBe(manifest2);
        expect(navControls1).toBe(navControls2);
    });

    it('returns the manifest object matching what was written', async () => {
        const result = await generateDevSwitcherFiles({
            deckRoot,
            decks: DECKS,
            currentSlug: 'intro',
            bridgeUrl: 'http://localhost:3000/__bridge',
            now: FIXED_DATE,
        });

        const raw = await fs.readFile(result.manifestPath, 'utf8');
        expect(result.manifest).toEqual(JSON.parse(raw));
    });

    it('backs up an existing custom-nav-controls.vue before overwriting it', async () => {
        const originalNavControls = '<template><div>existing nav</div></template>\n';
        await fs.writeFile(
            path.join(deckRoot, 'custom-nav-controls.vue'),
            originalNavControls,
            'utf8',
        );

        const result = await generateDevSwitcherFiles({
            deckRoot,
            decks: DECKS,
            currentSlug: 'intro',
            bridgeUrl: 'http://localhost:3000/__bridge',
            now: FIXED_DATE,
        });

        await expect(fs.readFile(result.navControlsBackupPath, 'utf8')).resolves.toBe(
            originalNavControls,
        );
    });

    it('removes legacy generated global-top.vue and SwitcherOverlay.vue during generation', async () => {
        const supportDir = path.join(deckRoot, SUPPORT_DIR_NAME);
        await fs.mkdir(supportDir, { recursive: true });
        await fs.writeFile(
            path.join(deckRoot, 'global-top.vue'),
            '<!-- Generated by vite-plugin-slidev-manager -->\n<template />\n',
            'utf8',
        );
        await fs.writeFile(
            path.join(supportDir, 'SwitcherOverlay.vue'),
            '<!-- Generated by vite-plugin-slidev-manager -->\n<template />\n',
            'utf8',
        );

        await generateDevSwitcherFiles({
            deckRoot,
            decks: DECKS,
            currentSlug: 'intro',
            bridgeUrl: 'http://localhost:3000/__bridge',
            now: FIXED_DATE,
        });

        await expect(fs.access(path.join(deckRoot, 'global-top.vue'))).rejects.toThrow();
        await expect(fs.access(path.join(supportDir, 'SwitcherOverlay.vue'))).rejects.toThrow();
    });
});

describe('cleanDevSwitcherFiles', () => {
    let deckRoot: string;

    beforeEach(async () => {
        deckRoot = path.join(TEST_ROOT, `deck-clean-${Date.now()}`);
        await fs.mkdir(deckRoot, { recursive: true });
    });

    afterEach(async () => {
        await fs.rm(TEST_ROOT, { recursive: true, force: true });
    });

    it('removes generated files when there were no originals', async () => {
        await generateDevSwitcherFiles({
            deckRoot,
            decks: DECKS,
            currentSlug: 'intro',
            bridgeUrl: 'http://localhost:3000/__bridge',
            now: FIXED_DATE,
        });

        await cleanDevSwitcherFiles(deckRoot);

        const supportDir = buildSupportDirPath(deckRoot);
        await expect(fs.access(supportDir)).rejects.toThrow();
        await expect(fs.access(path.join(deckRoot, 'custom-nav-controls.vue'))).rejects.toThrow();
    });

    it('does not throw when files do not exist', async () => {
        await expect(cleanDevSwitcherFiles(deckRoot)).resolves.toBeUndefined();
    });

    it('restores an original custom-nav-controls.vue when one was backed up', async () => {
        const originalNavControls = '<template><div>existing</div></template>\n';
        await fs.writeFile(
            path.join(deckRoot, 'custom-nav-controls.vue'),
            originalNavControls,
            'utf8',
        );

        await generateDevSwitcherFiles({
            deckRoot,
            decks: DECKS,
            currentSlug: 'intro',
            bridgeUrl: 'http://localhost:3000/__bridge',
            now: FIXED_DATE,
        });

        await cleanDevSwitcherFiles(deckRoot);

        await expect(
            fs.readFile(path.join(deckRoot, 'custom-nav-controls.vue'), 'utf8'),
        ).resolves.toBe(originalNavControls);
    });

    it('removes legacy generated overlay files during cleanup', async () => {
        const supportDir = path.join(deckRoot, SUPPORT_DIR_NAME);
        await generateDevSwitcherFiles({
            deckRoot,
            decks: DECKS,
            currentSlug: 'intro',
            bridgeUrl: 'http://localhost:3000/__bridge',
            now: FIXED_DATE,
        });

        await fs.writeFile(
            path.join(deckRoot, 'global-top.vue'),
            '<!-- Generated by vite-plugin-slidev-manager -->\n<template />\n',
            'utf8',
        );
        await fs.writeFile(
            path.join(supportDir, 'SwitcherOverlay.vue'),
            '<!-- Generated by vite-plugin-slidev-manager -->\n<template />\n',
            'utf8',
        );

        await cleanDevSwitcherFiles(deckRoot);

        await expect(fs.access(path.join(deckRoot, 'global-top.vue'))).rejects.toThrow();
        await expect(fs.access(path.join(supportDir, 'SwitcherOverlay.vue'))).rejects.toThrow();
    });
});