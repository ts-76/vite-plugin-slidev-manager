import { describe, expect, it } from 'vitest';
import type { PresentationMetadata } from '../src/presentation/metadata-loader.js';
import {
    createPresentationKey,
    formatPresentationLabel,
    toPresentationManifest,
    toSlug,
    type PresentationLabelInput,
} from '../src/presentation/presentation-helpers.js';

describe('toSlug', () => {
    it('uses folder name when workspace is null', () => {
        expect(toSlug('my-slides', null)).toBe('my-slides');
    });

    it('strips scope prefix from workspace name', () => {
        expect(toSlug('intro', '@org/intro-deck')).toBe('intro-deck');
    });

    it('uses workspace name directly when unscoped', () => {
        expect(toSlug('intro', 'intro-deck')).toBe('intro-deck');
    });

    it('lowercases and collapses non-alphanumeric runs', () => {
        expect(toSlug('My Fancy Slides!', null)).toBe('my-fancy-slides');
    });

    it('strips leading and trailing hyphens', () => {
        expect(toSlug('--hello--', null)).toBe('hello');
    });
});

describe('formatPresentationLabel', () => {
    it('shows title with scoped workspace slug when title differs from slug', () => {
        const input: PresentationLabelInput = {
            folder: 'intro',
            workspace: '@acme/intro-deck',
            title: 'Introduction',
            run: { type: 'workspace', workspace: '@acme/intro-deck', action: 'dev' },
        };
        expect(formatPresentationLabel(input)).toBe('Introduction (intro-deck)');
    });

    it('shows folder with full workspace when slug matches folder', () => {
        const input: PresentationLabelInput = {
            folder: 'intro-deck',
            workspace: '@acme/intro-deck',
            title: 'intro-deck',
            run: { type: 'workspace', workspace: '@acme/intro-deck', action: 'dev' },
        };
        expect(formatPresentationLabel(input)).toBe('intro-deck (@acme/intro-deck)');
    });

    it('shows folder with workspace when no title and slug differs', () => {
        const input: PresentationLabelInput = {
            folder: 'intro',
            workspace: '@acme/intro-deck',
            title: null,
            run: { type: 'workspace', workspace: '@acme/intro-deck', action: 'dev' },
        };
        expect(formatPresentationLabel(input)).toBe('intro (@acme/intro-deck)');
    });

    it('shows folder with workspace when workspace matches folder', () => {
        const input: PresentationLabelInput = {
            folder: 'intro',
            workspace: 'intro',
            title: null,
            run: { type: 'workspace', workspace: 'intro', action: 'dev' },
        };
        expect(formatPresentationLabel(input)).toBe('intro (intro)');
    });

    it('shows title with relative path for slides-type entries', () => {
        const input: PresentationLabelInput = {
            folder: 'advanced',
            workspace: null,
            title: 'Advanced Topics',
            run: {
                type: 'slides',
                relativeSlidesPath: 'presentations/advanced/slides.md',
                action: 'dev',
            },
        };
        expect(formatPresentationLabel(input)).toBe(
            'Advanced Topics (presentations/advanced/slides.md)',
        );
    });

    it('uses folder as fallback title for slides-type when title is null', () => {
        const input: PresentationLabelInput = {
            folder: 'advanced',
            workspace: null,
            title: null,
            run: {
                type: 'slides',
                relativeSlidesPath: 'presentations/advanced/slides.md',
                action: 'dev',
            },
        };
        expect(formatPresentationLabel(input)).toBe('advanced (presentations/advanced/slides.md)');
    });
});

describe('createPresentationKey', () => {
    it('produces action::folder::type::workspace for workspace entries', () => {
        const input: PresentationLabelInput = {
            folder: 'intro',
            workspace: '@acme/intro-deck',
            title: 'Introduction',
            run: { type: 'workspace', workspace: '@acme/intro-deck', action: 'dev' },
        };
        expect(createPresentationKey(input)).toBe('dev::intro::workspace::@acme/intro-deck');
    });

    it('falls back to folder when workspace is missing on workspace-type', () => {
        const input: PresentationLabelInput = {
            folder: 'intro',
            workspace: null,
            title: null,
            run: { type: 'workspace', action: 'build' },
        };
        expect(createPresentationKey(input)).toBe('build::intro::workspace::intro');
    });

    it('produces action::folder::slides::relativePath for slides entries', () => {
        const input: PresentationLabelInput = {
            folder: 'advanced',
            workspace: null,
            title: 'Advanced',
            run: {
                type: 'slides',
                relativeSlidesPath: 'presentations/advanced/slides.md',
                action: 'export',
            },
        };
        expect(createPresentationKey(input)).toBe(
            'export::advanced::slides::presentations/advanced/slides.md',
        );
    });
});

describe('toPresentationManifest', () => {
    const metadataFixtures: PresentationMetadata[] = [
        {
            folder: 'intro',
            presentationDir: '/root/presentations/intro',
            workspace: '@acme/intro-deck',
            scripts: { dev: 'slidev dev', build: 'slidev build' },
            availableActions: ['dev', 'build'],
            slidesPath: '/root/presentations/intro/slides.md',
            relativeSlidesPath: 'presentations/intro/slides.md',
            title: 'Introduction',
        },
        {
            folder: 'advanced',
            presentationDir: '/root/presentations/advanced',
            workspace: null,
            scripts: {},
            availableActions: ['dev', 'build', 'export'],
            slidesPath: '/root/presentations/advanced/slides.md',
            relativeSlidesPath: 'presentations/advanced/slides.md',
            title: 'Advanced Topics',
        },
        {
            folder: 'export-only',
            presentationDir: '/root/presentations/export-only',
            workspace: 'export-pkg',
            scripts: { export: 'slidev export' },
            availableActions: ['export'],
            slidesPath: null,
            relativeSlidesPath: null,
            title: null,
        },
    ];

    it('converts all metadata to manifest entries', () => {
        const manifest = toPresentationManifest(metadataFixtures);
        expect(manifest).toHaveLength(3);
    });

    it('produces JSON-serializable entries', () => {
        const manifest = toPresentationManifest(metadataFixtures);
        const roundTripped = JSON.parse(JSON.stringify(manifest));
        expect(roundTripped).toEqual(manifest);
    });

    it('assigns stable slugs', () => {
        const manifest = toPresentationManifest(metadataFixtures);
        expect(manifest.map((entry) => entry.slug)).toEqual([
            'intro-deck',
            'advanced',
            'export-pkg',
        ]);
    });

    it('sets capability flags correctly', () => {
        const manifest = toPresentationManifest(metadataFixtures);
        expect(manifest[0]).toMatchObject({ canDev: true, canBuild: true, canExport: false });
        expect(manifest[1]).toMatchObject({ canDev: true, canBuild: true, canExport: true });
        expect(manifest[2]).toMatchObject({ canDev: false, canBuild: false, canExport: true });
    });

    it('filters to dev-capable entries only', () => {
        const devOnly = toPresentationManifest(metadataFixtures, { canDev: true });
        expect(devOnly).toHaveLength(2);
        expect(devOnly.every((entry) => entry.canDev)).toBe(true);
    });

    it('filters to export-capable entries only', () => {
        const exportable = toPresentationManifest(metadataFixtures, { canExport: true });
        expect(exportable).toHaveLength(2);
        expect(exportable.every((entry) => entry.canExport)).toBe(true);
    });

    it('filters entries that cannot dev', () => {
        const noDev = toPresentationManifest(metadataFixtures, { canDev: false });
        expect(noDev).toHaveLength(1);
        expect(noDev[0]?.folder).toBe('export-only');
    });

    it('supports combined filter flags', () => {
        const devAndBuild = toPresentationManifest(metadataFixtures, {
            canDev: true,
            canBuild: true,
        });
        expect(devAndBuild).toHaveLength(2);
    });

    it('returns empty array when no metadata matches filter', () => {
        const none = toPresentationManifest(metadataFixtures, {
            canDev: true,
            canExport: true,
            canBuild: false,
        });
        expect(none).toHaveLength(0);
    });

    it('produces labels consistent with formatPresentationLabel', () => {
        const manifest = toPresentationManifest(metadataFixtures);
        const introEntry = manifest.find((entry) => entry.folder === 'intro');

        const directLabel = formatPresentationLabel({
            folder: 'intro',
            workspace: '@acme/intro-deck',
            title: 'Introduction',
            run: { type: 'workspace', workspace: '@acme/intro-deck', action: 'dev' },
        });

        expect(introEntry?.label).toBe(directLabel);
    });

    it('produces keys consistent with createPresentationKey', () => {
        const manifest = toPresentationManifest(metadataFixtures);
        const advancedEntry = manifest.find((entry) => entry.folder === 'advanced');

        const directKey = createPresentationKey({
            folder: 'advanced',
            workspace: null,
            title: 'Advanced Topics',
            run: {
                type: 'slides',
                relativeSlidesPath: 'presentations/advanced/slides.md',
                action: 'dev',
            },
        });

        expect(advancedEntry?.key).toBe(directKey);
    });
});
