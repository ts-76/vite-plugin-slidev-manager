import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LaunchContext } from '../src/dev-server-bridge.js';
import { createLaunchContext, startDevServerBridge } from '../src/dev-server-bridge.js';
import type { PresentationOption } from '../src/presentation-selector.js';

const TEST_ROOT = path.join(import.meta.dirname, '..', '.test-tmp-dev-server-bridge');

vi.mock('node:child_process', () => {
    return {
        spawn: vi.fn(() => {
            const listeners = new Map<string, ((...args: unknown[]) => void)[]>();

            return {
                exitCode: null as number | null,
                killed: false,
                on(event: string, cb: (...args: unknown[]) => void) {
                    const list = listeners.get(event) ?? [];
                    list.push(cb);
                    listeners.set(event, list);
                },
                once(event: string, cb: (...args: unknown[]) => void) {
                    const wrapper = (...args: unknown[]) => {
                        cb(...args);
                    };
                    const list = listeners.get(event) ?? [];
                    list.push(wrapper);
                    listeners.set(event, list);
                },
                kill(signal: string) {
                    this.killed = true;
                    this.exitCode = 0;
                    const exitCallbacks = listeners.get('exit') ?? [];
                    for (const callback of exitCallbacks) {
                        callback(0, signal);
                    }
                    listeners.clear();
                },
                unref() {
                    return undefined;
                },
            };
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
        presentationDir: path.dirname(slidesPath),
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
    pathValue: string,
): Promise<{ status: number; body: unknown }> {
    return new Promise((resolve, reject) => {
        const req = http.request({ hostname: '127.0.0.1', port, path: pathValue, method }, (res) => {
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
    let upstreamPorts: number[];
    let upstreamServers: http.Server[];
    let deckAPort: number;
    let deckBPort: number;

    beforeEach(async () => {
        vi.clearAllMocks();
        deckARoot = path.join(TEST_ROOT, `deck-a-${Date.now()}`);
        deckBRoot = path.join(TEST_ROOT, `deck-b-${Date.now()}`);
        await fs.mkdir(deckARoot, { recursive: true });
        await fs.mkdir(deckBRoot, { recursive: true });
        await fs.writeFile(path.join(deckARoot, 'slides.md'), '# deck-a\n', 'utf8');
        await fs.writeFile(path.join(deckBRoot, 'slides.md'), '# deck-b\n', 'utf8');

        const deckA = makePresentationOption('deck-a', path.join(deckARoot, 'slides.md'));
        const deckB = makePresentationOption('deck-b', path.join(deckBRoot, 'slides.md'));
        context = createLaunchContext(deckA, [deckA, deckB], ['--port', '0']);
        upstreamServers = [];
        deckAPort = await startUpstreamServer('deck-a', upstreamServers);
        deckBPort = await startUpstreamServer('deck-b', upstreamServers);
        upstreamPorts = [deckAPort, deckBPort];
    });

    afterEach(async () => {
        await Promise.all(
            upstreamServers.map(
                (server) =>
                    new Promise<void>((resolve) => {
                        server.close(() => resolve());
                    }),
            ),
        );
        await fs.rm(TEST_ROOT, { recursive: true, force: true });
        vi.restoreAllMocks();
    });

    it('starts a stable bridge port and proxies the selected deck', async () => {
        const { spawn } = await import('node:child_process');
        const bridge = await startDevServerBridge(context, makeRuntime(upstreamPorts));

        try {
            expect(bridge.bridgePort).toBeGreaterThan(0);
            expect(bridge.currentFolder).toBe('deck-a');
            expect(spawn).toHaveBeenCalledWith(
                'node',
                ['/mock/slidev.mjs', 'slides.md', '--port', String(deckAPort)],
                expect.objectContaining({
                    cwd: deckARoot,
                    stdio: 'inherit',
                }),
            );
            const root = await request(bridge.bridgePort, 'GET', '/');
            expect(root.status).toBe(200);
            expect(root.body).toBe('deck:deck-a');
            await expect(
                fs.access(path.join(deckARoot, '.slidev-manager', 'manifest.json')),
            ).resolves.toBeUndefined();
            await expect(
                fs.access(path.join(deckARoot, 'custom-nav-controls.vue')),
            ).resolves.toBeUndefined();
        } finally {
            await bridge.stop();
        }
    });

    it('GET /__bridge/presentations returns current folder and all presentations', async () => {
        const bridge = await startDevServerBridge(context, makeRuntime(upstreamPorts));

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

    it('POST /__bridge/switch?folder=deck-b swaps the upstream while keeping the public bridge stable', async () => {
        const { spawn } = await import('node:child_process');
        const bridge = await startDevServerBridge(context, makeRuntime(upstreamPorts));

        try {
            const res = await request(bridge.bridgePort, 'POST', '/__bridge/switch?folder=deck-b');

            expect(res.status).toBe(200);
            expect(typeof res.body).toBe('string');
            expect(String(res.body)).toContain('Switched to &quot;deck-b&quot;.');
            expect(String(res.body)).toContain('window.top.location.replace');
            expect(bridge.currentFolder).toBe('deck-b');
            expect(spawn).toHaveBeenCalledTimes(2);
            expect(spawn).toHaveBeenLastCalledWith(
                'node',
                ['/mock/slidev.mjs', 'slides.md', '--port', String(deckBPort)],
                expect.objectContaining({
                    cwd: deckBRoot,
                }),
            );
            const root = await request(bridge.bridgePort, 'GET', '/');
            expect(root.status).toBe(200);
            expect(root.body).toBe('deck:deck-b');
            await waitForMissing(path.join(deckARoot, 'custom-nav-controls.vue'));
            await expect(
                fs.access(path.join(deckBRoot, 'custom-nav-controls.vue')),
            ).resolves.toBeUndefined();
        } finally {
            await bridge.stop();
        }
    });

    it('POST /__bridge/switch returns already_running when switching to the current deck', async () => {
        const bridge = await startDevServerBridge(context, makeRuntime(upstreamPorts));

        try {
            const res = await request(bridge.bridgePort, 'POST', '/__bridge/switch?folder=deck-a');

            expect(res.status).toBe(200);
            expect(typeof res.body).toBe('string');
            expect(String(res.body)).toContain('&quot;deck-a&quot; is already running.');
            expect(String(res.body)).toContain('window.top.location.replace');
        } finally {
            await bridge.stop();
        }
    });

    it('POST /__bridge/switch returns 404 for unknown folder', async () => {
        const bridge = await startDevServerBridge(context, makeRuntime(upstreamPorts));

        try {
            const res = await request(bridge.bridgePort, 'POST', '/__bridge/switch?folder=unknown');

            expect(res.status).toBe(404);
            expect(res.body).toEqual({ error: 'Presentation "unknown" not found' });
        } finally {
            await bridge.stop();
        }
    });

    it('POST /__bridge/switch returns 400 when folder parameter is missing', async () => {
        const bridge = await startDevServerBridge(context, makeRuntime(upstreamPorts));

        try {
            const res = await request(bridge.bridgePort, 'POST', '/__bridge/switch');

            expect(res.status).toBe(400);
            expect(res.body).toEqual({ error: 'Missing "folder" query parameter' });
        } finally {
            await bridge.stop();
        }
    });

    it('proxies unknown routes to the active upstream', async () => {
        const bridge = await startDevServerBridge(context, makeRuntime(upstreamPorts));

        try {
            const res = await request(bridge.bridgePort, 'GET', '/unknown');

            expect(res.status).toBe(404);
            expect(res.body).toBe('missing:deck-a');
        } finally {
            await bridge.stop();
        }
    });
});

function makeRuntime(ports: number[]) {
    return {
        reservePort: async () => ports.shift() ?? 0,
        waitForReady: async () => undefined,
        openBrowser: async () => undefined,
    };
}

async function startUpstreamServer(name: string, servers: http.Server[]): Promise<number> {
    const server = http.createServer((req, res) => {
        if (req.url === '/') {
            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end(`deck:${name}`);
            return;
        }

        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end(`missing:${name}`);
    });
    servers.push(server);

    return new Promise((resolve, reject) => {
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                reject(new Error('Could not determine upstream port'));
                return;
            }

            resolve(address.port);
        });

        server.on('error', reject);
    });
}

function nextTick(): Promise<void> {
    return new Promise((resolve) => {
        setTimeout(resolve, 0);
    });
}

async function waitForMissing(filePath: string): Promise<void> {
    for (let index = 0; index < 10; index += 1) {
        try {
            await fs.access(filePath);
        } catch {
            return;
        }

        await nextTick();
    }

    throw new Error(`File still exists: ${filePath}`);
}