import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanDevSwitcherFiles, generateDevSwitcherFiles } from '../src/bridge/dev-switcher.js';
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

describe('generateDevSwitcherFiles', () => {
    let deckRoot: string;

    beforeEach(async () => {
        deckRoot = path.join(TEST_ROOT, `deck-${Date.now()}`);
        await fs.mkdir(deckRoot, { recursive: true });
    });

    afterEach(async () => {
        await fs.rm(TEST_ROOT, { recursive: true, force: true });
    });

    it('writes custom-nav-controls.vue in the deck root', async () => {
        const result = await generateDevSwitcherFiles({
            deckRoot,
            decks: DECKS,
            currentSlug: 'advanced',
            bridgeUrl: 'http://localhost:3000/__bridge',
        });

        expect(result.navControlsPath).toBe(path.join(deckRoot, 'custom-nav-controls.vue'));

        const content = await fs.readFile(result.navControlsPath, 'utf8');
        expect(content).toContain('<template>');
        expect(content).toContain('method="POST"');
        expect(content).toContain(
            'formaction="http://localhost:3000/__bridge/switch?folder=intro"',
        );
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
        };

        const result1 = await generateDevSwitcherFiles(opts);
        const navControls1 = await fs.readFile(result1.navControlsPath, 'utf8');

        const result2 = await generateDevSwitcherFiles(opts);
        const navControls2 = await fs.readFile(result2.navControlsPath, 'utf8');

        expect(navControls1).toBe(navControls2);
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
        });

        await cleanDevSwitcherFiles(deckRoot);

        await expect(fs.access(path.join(deckRoot, 'custom-nav-controls.vue'))).rejects.toThrow();
    });

    it('does not throw when files do not exist', async () => {
        await expect(cleanDevSwitcherFiles(deckRoot)).resolves.toBeUndefined();
    });
});
