import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { selectPresentation } from '../src/selector/presentation-selector.js';

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

describe('selectPresentation', () => {
    it('automatically selects the only available presentation', async () => {
        const presentationsDir = await createPresentationsFixture(['solo-deck']);

        const result = await selectPresentation({
            action: 'build',
            heading: 'Select',
            helpText: 'Help',
            presentationsDir,
        });

        expect(result.selected?.folder).toBe('solo-deck');
        expect(result.reason).toBe('single-option');
    });

    it('returns a non-interactive reason when multiple options are available without a TTY', async () => {
        Object.defineProperty(process.stdin, 'isTTY', {
            configurable: true,
            value: false,
        });
        Object.defineProperty(process.stdout, 'isTTY', {
            configurable: true,
            value: false,
        });

        const presentationsDir = await createPresentationsFixture(['deck-a', 'deck-b']);
        const result = await selectPresentation({
            action: 'build',
            heading: 'Select',
            helpText: 'Help',
            presentationsDir,
        });

        expect(result.selected).toBeNull();
        expect(result.reason).toBe('non-interactive-without-selection');
    });

    it('uses the preselected folder when provided', async () => {
        const result = await selectPresentation({
            action: 'build',
            heading: 'Select',
            helpText: 'Help',
            presentationsDir: new URL('../../slides/presentations', import.meta.url).pathname,
            preselectedFolder: 'minimal-demo',
        });

        expect(result.selected?.folder).toBe('minimal-demo');
        expect(result.reason).toBe('preselected');
    });
});

async function createPresentationsFixture(folders: string[]) {
    const presentationsDir = await fs.mkdtemp(path.join(os.tmpdir(), 'slidev-manager-test-'));

    await Promise.all(
        folders.map(async (folder) => {
            const presentationDir = path.join(presentationsDir, folder);
            await fs.mkdir(presentationDir, { recursive: true });
            await fs.writeFile(path.join(presentationDir, 'slides.md'), `# ${folder}\n`);
        }),
    );

    return presentationsDir;
}
