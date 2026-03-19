import fs from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    createDevSpawnSpec,
    runPresentationAction,
    waitForHttpReady,
} from '../src/presentation/presentation-runner.js';
import type { PresentationOption } from '../src/selector/presentation-selector.js';

const TEST_ROOT = path.join(import.meta.dirname, '..', '.test-tmp-presentation-runner');

vi.mock('node:child_process', () => ({
    spawn: vi.fn(() => ({
        on(event: string, callback: (...args: unknown[]) => void) {
            if (event === 'exit') {
                callback(0);
            }
        },
    })),
}));

vi.mock('node:module', () => ({
    createRequire: () => ({
        resolve: () => '/mock/slidev.mjs',
    }),
}));

afterEach(async () => {
    await fs.rm(TEST_ROOT, { recursive: true, force: true });
    vi.restoreAllMocks();
});

describe('createDevSpawnSpec', () => {
    it('creates a slidev dev command with an internal port and no --open flag', async () => {
        const selection = makeSlidesOption('/root/presentations/intro/slides.md');

        const spec = await createDevSpawnSpec(selection, ['--open', '--port', '3030'], 41001);

        expect(spec).toEqual({
            command: 'node',
            args: ['/mock/slidev.mjs', 'slides.md', '--port', '41001'],
            cwd: '/root/presentations/intro',
            env: expect.objectContaining({ NODE_ENV: 'development' }),
        });
    });

    it('creates a workspace dev command using the detected package manager', async () => {
        const presentationDir = path.join(TEST_ROOT, 'workspace-deck');
        await fs.mkdir(presentationDir, { recursive: true });
        await fs.writeFile(
            path.join(presentationDir, 'package.json'),
            JSON.stringify({ packageManager: 'pnpm@9.0.0' }),
            'utf8',
        );

        const spec = await createDevSpawnSpec(
            {
                folder: 'workspace-deck',
                presentationDir,
                workspace: '@acme/workspace-deck',
                title: 'Workspace Deck',
                run: { type: 'workspace', workspace: '@acme/workspace-deck', action: 'dev' },
                slidesPath: null,
                relativeSlidesPath: null,
            },
            ['--open', '--base', '/deck/'],
            41002,
        );

        expect(spec).toEqual({
            command: 'pnpm',
            args: ['run', 'dev', '--', '--base', '/deck/', '--port', '41002'],
            cwd: presentationDir,
            env: expect.objectContaining({ NODE_ENV: 'development' }),
        });
    });
});

describe('runPresentationAction', () => {
    it('runs workspace build scripts through the detected package manager', async () => {
        const presentationDir = path.join(TEST_ROOT, 'build-deck');
        await fs.mkdir(presentationDir, { recursive: true });
        await fs.writeFile(path.join(TEST_ROOT, 'yarn.lock'), '', 'utf8');

        const code = await runPresentationAction(
            {
                folder: 'build-deck',
                presentationDir,
                workspace: 'build-deck',
                title: 'Build Deck',
                run: { type: 'workspace', workspace: 'build-deck', action: 'build' },
                slidesPath: null,
                relativeSlidesPath: null,
            },
            'build',
            ['--out', 'dist/slides'],
        );

        const { spawn } = await import('node:child_process');

        expect(code).toBe(0);
        expect(spawn).toHaveBeenCalledWith(
            'yarn',
            ['run', 'build', '--out', 'dist/slides'],
            expect.objectContaining({
                cwd: presentationDir,
                stdio: 'inherit',
            }),
        );
    });
});

describe('waitForHttpReady', () => {
    it('treats any HTTP response as ready, including 404', async () => {
        const server = http.createServer((_req, res) => {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('not found');
        });

        const port = await new Promise<number>((resolve, reject) => {
            server.listen(0, '127.0.0.1', () => {
                const address = server.address();
                if (!address || typeof address === 'string') {
                    reject(new Error('Could not determine port'));
                    return;
                }

                resolve(address.port);
            });

            server.on('error', reject);
        });

        try {
            await expect(
                waitForHttpReady(`http://127.0.0.1:${port}/`, 1000),
            ).resolves.toBeUndefined();
        } finally {
            await new Promise<void>((resolve) => {
                server.close(() => resolve());
            });
        }
    });
});

function makeSlidesOption(slidesPath: string): PresentationOption {
    return {
        folder: 'intro',
        presentationDir: path.dirname(slidesPath),
        workspace: null,
        title: 'Intro',
        run: { type: 'slides', slidesPath, action: 'dev' },
        slidesPath,
        relativeSlidesPath: 'presentations/intro/slides.md',
    };
}
