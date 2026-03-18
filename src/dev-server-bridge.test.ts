import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LaunchContext } from './dev-server-bridge.js';
import { createLaunchContext, startDevServerBridge } from './dev-server-bridge.js';
import type { PresentationOption } from './presentation-selector.js';

const TEST_ROOT = path.join(import.meta.dirname, '..', '.test-tmp-dev-server-bridge');

vi.mock('node:child_process', () => {
    const listeners = new Map<string, ((...args: unknown[]) => void)[]>();

    const fakeProcess = {
        on(event: string, cb: (...args: unknown[]) => void) {
            const list = listeners.get(event) ?? [];
            list.push(cb);
            listeners.set(event, list);
        },
        kill(signal: string) {
            const exitCbs = listeners.get('exit') ?? [];
            for (const cb of exitCbs) {
                cb(null, signal);
            }
            listeners.clear();
        },
        _listeners: listeners,
    };

    return {
        spawn: vi.fn(() => {
            listeners.clear();
            return fakeProcess;
        }),
    };
});

vi.mock('node:module', () => ({
    createRequire: () => ({
        resolve: () => '/mock/slidev.mjs',
    }),
}));

function makePresentationOption(folder: string, slidesPath: string): PresentationOption {
    return {
        folder,
        workspace: null,
        title: `Title ${folder}`,
        run: { type: 'slides', slidesPath, action: 'dev' },
        slidesPath,
        relativeSlidesPath: `presentations/${folder}/slides.md`,
    };
}

function request(
    port: number,
    method: string,
    path: string,
): Promise<{ status: number; body: unknown }> {
    return new Promise((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port, path, method }, (res) => {
            let data = '';
            res.on('data', (chunk: Buffer) => {
                data += chunk.toString();
            });
            res.on('end', () => {
                const contentType = String(res.headers['content-type'] ?? '');
                resolve({
                    status: res.statusCode ?? 0,
                    body: contentType.includes('application/json') ? JSON.parse(data) : data,
                });
            });
        });
        req.on('error', reject);
        req.end();
    });
}

describe('createLaunchContext', () => {
    it('creates a launch context from selected presentation, all presentations, and args', () => {
        const selected = makePresentationOption('deck-a', '/root/presentations/deck-a/slides.md');
        const all = [
            selected,
            makePresentationOption('deck-b', '/root/presentations/deck-b/slides.md'),
        ];
        const args = ['--port', '3030', '--open'];

        const context = createLaunchContext(selected, all, args);

        expect(context).toEqual({
            selected,
            presentations: all,
            args,
        });
    });
});

describe('startDevServerBridge', () => {
    let context: LaunchContext;
    let deckARoot: string;
    let deckBRoot: string;

    beforeEach(() => {
        vi.clearAllMocks();
    });

    beforeEach(async () => {
        deckARoot = path.join(TEST_ROOT, `deck-a-${Date.now()}`);
        deckBRoot = path.join(TEST_ROOT, `deck-b-${Date.now()}`);
        await fs.mkdir(deckARoot, { recursive: true });
        await fs.mkdir(deckBRoot, { recursive: true });
        await fs.writeFile(path.join(deckARoot, 'slides.md'), '# deck-a\n', 'utf8');
        await fs.writeFile(path.join(deckBRoot, 'slides.md'), '# deck-b\n', 'utf8');

        const deckA = makePresentationOption('deck-a', path.join(deckARoot, 'slides.md'));
        const deckB = makePresentationOption('deck-b', path.join(deckBRoot, 'slides.md'));
        context = createLaunchContext(deckA, [deckA, deckB], ['--port', '3030']);
    });

    afterEach(async () => {
        await fs.rm(TEST_ROOT, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('starts an HTTP bridge on a random port and launches Slidev for the selected deck', async () => {
        const { spawn } = await import('node:child_process');
        const bridge = await startDevServerBridge(context);

        try {
            expect(bridge.bridgePort).toBeGreaterThan(0);
            expect(bridge.currentFolder).toBe('deck-a');
            expect(spawn).toHaveBeenCalledWith(
                'node',
                ['/mock/slidev.mjs', 'slides.md', '--port', '3030'],
                expect.objectContaining({
                    cwd: deckARoot,
                    stdio: 'inherit',
                }),
            );
            await expect(
                fs.access(path.join(deckARoot, '.slidev-manager', 'manifest.json')),
            ).resolves.toBeUndefined();
            await expect(
                fs.access(path.join(deckARoot, 'custom-nav-controls.vue')),
            ).resolves.toBeUndefined();
            await expect(
                fs.access(path.join(deckARoot, 'setup', 'context-menu.ts')),
            ).resolves.toBeUndefined();
        } finally {
            await bridge.stop();
        }
    });

    it('GET /__bridge/presentations returns current folder and all presentations', async () => {
        const bridge = await startDevServerBridge(context);

        try {
            const res = await request(bridge.bridgePort, 'GET', '/__bridge/presentations');

            expect(res.status).toBe(200);
            expect(res.body).toEqual({
                current: 'deck-a',
                presentations: [
                    {
                        folder: 'deck-a',
                        label: 'Title deck-a (presentations/deck-a/slides.md)',
                        slug: 'deck-a',
                        title: 'Title deck-a',
                        detail: 'presentations/deck-a/slides.md',
                    },
                    {
                        folder: 'deck-b',
                        label: 'Title deck-b (presentations/deck-b/slides.md)',
                        slug: 'deck-b',
                        title: 'Title deck-b',
                        detail: 'presentations/deck-b/slides.md',
                    },
                ],
            });
        } finally {
            await bridge.stop();
        }
    });

    it('POST /__bridge/switch?folder=deck-b kills old Slidev and relaunches with new deck', async () => {
        const { spawn } = await import('node:child_process');
        const bridge = await startDevServerBridge(context);

        try {
            const res = await request(bridge.bridgePort, 'POST', '/__bridge/switch?folder=deck-b');

            expect(res.status).toBe(200);
            expect(typeof res.body).toBe('string');
            expect(String(res.body)).toContain('Switching to &quot;deck-b&quot;...');
            expect(String(res.body)).toContain('window.top.location.replace');
            expect(String(res.body)).toContain('waitForServer');
            expect(String(res.body)).toContain("method: 'HEAD'");
            expect(bridge.currentFolder).toBe('deck-b');
            expect(spawn).toHaveBeenCalledTimes(2);
            expect(spawn).toHaveBeenLastCalledWith(
                'node',
                ['/mock/slidev.mjs', 'slides.md', '--port', '3030'],
                expect.objectContaining({
                    cwd: deckBRoot,
                }),
            );
            await expect(
                fs.access(path.join(deckARoot, 'custom-nav-controls.vue')),
            ).rejects.toThrow();
            await expect(
                fs.access(path.join(deckBRoot, 'custom-nav-controls.vue')),
            ).resolves.toBeUndefined();
            await expect(
                fs.access(path.join(deckBRoot, 'setup', 'context-menu.ts')),
            ).resolves.toBeUndefined();
        } finally {
            await bridge.stop();
        }
    });

    it('POST /__bridge/switch returns already_running when switching to the current deck', async () => {
        const bridge = await startDevServerBridge(context);

        try {
            const res = await request(bridge.bridgePort, 'POST', '/__bridge/switch?folder=deck-a');

            expect(res.status).toBe(200);
            expect(typeof res.body).toBe('string');
            expect(String(res.body)).toContain('&quot;deck-a&quot; is already running.');
            expect(String(res.body)).toContain('window.top.location.replace');
            expect(String(res.body)).toContain('waitForServer');
        } finally {
            await bridge.stop();
        }
    });

    it('POST /__bridge/switch returns 404 for unknown folder', async () => {
        const bridge = await startDevServerBridge(context);

        try {
            const res = await request(bridge.bridgePort, 'POST', '/__bridge/switch?folder=unknown');

            expect(res.status).toBe(404);
            expect(res.body).toEqual({ error: 'Presentation "unknown" not found' });
        } finally {
            await bridge.stop();
        }
    });

    it('POST /__bridge/switch returns 400 when folder parameter is missing', async () => {
        const bridge = await startDevServerBridge(context);

        try {
            const res = await request(bridge.bridgePort, 'POST', '/__bridge/switch');

            expect(res.status).toBe(400);
            expect(res.body).toEqual({ error: 'Missing "folder" query parameter' });
        } finally {
            await bridge.stop();
        }
    });

    it('returns 404 for unknown routes', async () => {
        const bridge = await startDevServerBridge(context);

        try {
            const res = await request(bridge.bridgePort, 'GET', '/unknown');

            expect(res.status).toBe(404);
        } finally {
            await bridge.stop();
        }
    });
});
