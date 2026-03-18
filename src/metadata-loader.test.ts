import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPresentationMetadata } from './metadata-loader.js';

vi.mock('node:fs/promises');

describe('loadPresentationMetadata', () => {
    const mockCwd = '/mock/cwd';
    const presentationsDir = path.join(mockCwd, 'presentations');

    beforeEach(() => {
        vi.spyOn(process, 'cwd').mockReturnValue(mockCwd);
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('returns an empty array if the presentations directory does not exist', async () => {
        vi.mocked(fs.readdir).mockRejectedValue(createNodeError('ENOENT'));

        const metadata = await loadPresentationMetadata(mockCwd);

        expect(metadata).toEqual([]);
    });

    it('loads metadata from valid presentation folders', async () => {
        vi.mocked(fs.readdir).mockResolvedValue([
            createDirent('pres1'),
            createDirent('pres2'),
            createFileDirent('file.txt'),
        ] as unknown as Awaited<ReturnType<typeof fs.readdir>>);

        vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
            const normalizedPath = String(filePath);

            if (normalizedPath.endsWith('pres1/package.json')) {
                return JSON.stringify({
                    name: 'pres1-workspace',
                    title: 'Presentation 1',
                    scripts: {
                        dev: 'slidev dev',
                        build: 'slidev build',
                    },
                });
            }

            if (normalizedPath.endsWith('pres2/slides.md')) {
                return 'title: Presentation 2\n# Slide 1';
            }

            throw createNodeError('ENOENT');
        });

        vi.mocked(fs.access).mockImplementation(async (filePath) => {
            const normalizedPath = String(filePath);

            if (normalizedPath.endsWith('pres2/slides.md')) {
                return undefined;
            }

            throw createNodeError('ENOENT');
        });

        const metadata = await loadPresentationMetadata(mockCwd);

        expect(metadata).toEqual([
            {
                folder: 'pres1',
                workspace: 'pres1-workspace',
                scripts: {
                    dev: 'slidev dev',
                    build: 'slidev build',
                },
                availableActions: ['dev', 'build'],
                slidesPath: null,
                relativeSlidesPath: null,
                title: 'Presentation 1',
            },
            {
                folder: 'pres2',
                workspace: null,
                scripts: {},
                availableActions: ['dev', 'build', 'export'],
                slidesPath: path.join(presentationsDir, 'pres2/slides.md'),
                relativeSlidesPath: 'presentations/pres2/slides.md',
                title: 'Presentation 2',
            },
        ]);
    });

    it('loads metadata from a custom presentations directory', async () => {
        const customDir = path.join(mockCwd, 'custom-presentations');

        vi.mocked(fs.readdir).mockImplementation(async (dirPath) => {
            if (String(dirPath) === customDir) {
                return [createDirent('custom-pres')] as unknown as Awaited<
                    ReturnType<typeof fs.readdir>
                >;
            }

            throw createNodeError('ENOENT');
        });

        vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
            if (String(filePath).endsWith('custom-pres/package.json')) {
                return JSON.stringify({
                    name: 'custom-workspace',
                    title: 'Custom Presentation',
                    scripts: {
                        export: 'slidev export',
                    },
                });
            }

            throw createNodeError('ENOENT');
        });

        vi.mocked(fs.access).mockRejectedValue(createNodeError('ENOENT'));

        const metadata = await loadPresentationMetadata(mockCwd, customDir);

        expect(metadata).toEqual([
            {
                folder: 'custom-pres',
                workspace: 'custom-workspace',
                scripts: {
                    export: 'slidev export',
                },
                availableActions: ['export'],
                slidesPath: null,
                relativeSlidesPath: null,
                title: 'Custom Presentation',
            },
        ]);
    });
});

function createDirent(name: string): Dirent {
    return {
        name,
        parentPath: '',
        path: '',
        isBlockDevice: () => false,
        isCharacterDevice: () => false,
        isDirectory: () => true,
        isFIFO: () => false,
        isFile: () => false,
        isSocket: () => false,
        isSymbolicLink: () => false,
    } as Dirent;
}

function createFileDirent(name: string): Dirent {
    return {
        ...createDirent(name),
        isDirectory: () => false,
        isFile: () => true,
    } as Dirent;
}

function createNodeError(code: string): NodeJS.ErrnoException {
    const error = new Error(code) as NodeJS.ErrnoException;
    error.code = code;
    return error;
}
