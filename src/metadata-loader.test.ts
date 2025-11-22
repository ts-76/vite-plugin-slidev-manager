import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadPresentationMetadata } from './metadata-loader.js';

// Mock fs.readdir and fs.readFile
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

    it('should return empty array if presentations directory does not exist', async () => {
        vi.mocked(fs.readdir).mockRejectedValue({ code: 'ENOENT' });

        const metadata = await loadPresentationMetadata(mockCwd);
        expect(metadata).toEqual([]);
    });

    it('should load metadata from valid presentation folders', async () => {
        const mockEntries = [
            { name: 'pres1', isDirectory: () => true },
            { name: 'pres2', isDirectory: () => true },
            { name: 'file.txt', isDirectory: () => false },
        ] as unknown as Dirent[];

        // biome-ignore lint/suspicious/noExplicitAny: Mocking complex type
        vi.mocked(fs.readdir).mockResolvedValue(mockEntries as any);

        // Mock inspectPresentation behavior by mocking fs.readFile and fs.access
        vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
            if (
                typeof filePath === 'string' &&
                filePath.endsWith('pres1/package.json')
            ) {
                return JSON.stringify({
                    name: 'pres1-workspace',
                    title: 'Presentation 1',
                });
            }
            throw { code: 'ENOENT' };
        });

        vi.mocked(fs.access).mockImplementation(async (filePath) => {
            if (
                typeof filePath === 'string' &&
                filePath.endsWith('pres2/slides.md')
            ) {
                return undefined;
            }
            throw { code: 'ENOENT' };
        });

        // For pres2 title inference
        vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
            if (
                typeof filePath === 'string' &&
                filePath.endsWith('pres2/slides.md')
            ) {
                return 'title: Presentation 2\n# Slide 1';
            }
            if (
                typeof filePath === 'string' &&
                filePath.endsWith('pres1/package.json')
            ) {
                return JSON.stringify({
                    name: 'pres1-workspace',
                    title: 'Presentation 1',
                });
            }
            throw { code: 'ENOENT' };
        });

        const metadata = await loadPresentationMetadata(mockCwd);

        expect(metadata).toHaveLength(2);

        // Sort order is by folder name
        expect(metadata[0]).toEqual({
            folder: 'pres1',
            workspace: 'pres1-workspace',
            scripts: {},
            slidesPath: null,
            relativeSlidesPath: null,
            title: 'Presentation 1',
        });

        expect(metadata[1]).toEqual({
            folder: 'pres2',
            workspace: null,
            scripts: {},
            slidesPath: path.join(presentationsDir, 'pres2/slides.md'),
            relativeSlidesPath: 'presentations/pres2/slides.md',
            title: 'Presentation 2',
        });
    });

    it('should load metadata from custom presentations directory', async () => {
        const customDir = path.join(mockCwd, 'custom-presentations');

        // Mock readdir for custom directory
        // biome-ignore lint/suspicious/noExplicitAny: Mocking complex type
        (vi.mocked(fs.readdir) as any).mockImplementation(
            async (dirPath: string) => {
                if (dirPath === customDir) {
                    return [
                        { name: 'custom-pres', isDirectory: () => true },
                    ] as unknown as Dirent[];
                }
                throw { code: 'ENOENT' };
            },
        );

        // Mock readFile/access for custom presentation
        vi.mocked(fs.readFile).mockImplementation(async (filePath) => {
            if (
                typeof filePath === 'string' &&
                filePath.endsWith('custom-pres/package.json')
            ) {
                return JSON.stringify({
                    name: 'custom-workspace',
                    title: 'Custom Presentation',
                });
            }
            throw { code: 'ENOENT' };
        });

        vi.mocked(fs.access).mockRejectedValue({ code: 'ENOENT' });

        const metadata = await loadPresentationMetadata(mockCwd, customDir);

        expect(metadata).toHaveLength(1);
        expect(metadata[0]).toEqual({
            folder: 'custom-pres',
            workspace: 'custom-workspace',
            scripts: {},
            slidesPath: null,
            relativeSlidesPath: null,
            title: 'Custom Presentation',
        });
    });
});
