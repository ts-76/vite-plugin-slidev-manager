import type { PresentationAction, PresentationMetadata } from './metadata-loader.js';

export interface PresentationLabelInput {
    folder: string;
    workspace: string | null;
    title: string | null;
    date?: string | null;
    author?: string | null;
    run: {
        type: 'workspace' | 'slides';
        workspace?: string;
        relativeSlidesPath?: string;
        action: PresentationAction;
    };
}

export interface DevManifestEntry {
    slug: string;
    folder: string;
    title: string | null;
    workspace: string | null;
    relativeSlidesPath: string | null;
    date: string | null;
    author: string | null;
    canDev: boolean;
    canBuild: boolean;
    canExport: boolean;
    label: string;
    key: string;
}

export interface PresentationListItem {
    primary: string;
    secondary: string | null;
    meta: string[];
}

export interface PresentationSearchInput {
    folder: string;
    title: string | null;
    author: string | null;
}

/**
 * Lowercase, collapse non-alphanumeric runs to hyphens, strip scope prefix.
 * Uses workspace package name when available, otherwise folder name.
 */
export function toSlug(folder: string, workspace: string | null): string {
    const base = workspace ? stripWorkspaceScope(workspace) : folder;
    return base
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '');
}

export function formatPresentationLabel(input: PresentationLabelInput): string {
    const primary = input.title ?? input.folder;
    const detail =
        input.run.type === 'workspace'
            ? (input.workspace ?? input.folder)
            : (input.run.relativeSlidesPath ?? input.folder);

    if (input.run.type === 'workspace' && input.title && input.title !== input.folder) {
        return `${primary} (${toSlug(input.folder, input.workspace)})`;
    }

    return `${primary} (${detail})`;
}

export function formatPresentationListItem(input: PresentationLabelInput): PresentationListItem {
    const primary = input.title ?? input.folder;
    const secondary = input.title && input.title !== input.folder ? input.folder : null;
    const meta = [input.date ?? null, input.author ?? null].filter(
        (value): value is string => Boolean(value),
    );

    if (!input.title || input.title === input.folder) {
        const detail =
            input.run.type === 'workspace'
                ? (input.workspace ?? input.folder)
                : (input.run.relativeSlidesPath ?? input.folder);
        if (detail && detail !== primary) {
            meta.push(detail);
        }
    } else if (input.run.type === 'slides' && input.run.relativeSlidesPath) {
        meta.push(input.run.relativeSlidesPath);
    } else if (input.run.type === 'workspace' && input.workspace) {
        meta.push(input.workspace);
    }

    return {
        primary,
        secondary,
        meta,
    };
}

export function createPresentationKey(input: PresentationLabelInput): string {
    const { action } = input.run;
    const detail =
        input.run.type === 'workspace'
            ? (input.run.workspace ?? input.folder)
            : (input.run.relativeSlidesPath ?? '');
    return `${action}::${input.folder}::${input.run.type}::${detail}`;
}

export function fuzzyScore(target: string, query: string): number {
    const normalizedTarget = target.toLowerCase();
    const normalizedQuery = query.trim().toLowerCase();

    if (!normalizedQuery) {
        return 0;
    }

    if (normalizedTarget === normalizedQuery) {
        return 100;
    }

    if (normalizedTarget.startsWith(normalizedQuery)) {
        return 80;
    }

    if (normalizedTarget.includes(normalizedQuery)) {
        return 60;
    }

    const queryWords = normalizedQuery.split(/[\s-]+/).filter(Boolean);
    if (
        queryWords.length > 1 &&
        queryWords.every((word) => normalizedTarget.includes(word))
    ) {
        return 40;
    }

    let targetIndex = 0;
    for (const char of normalizedQuery) {
        const matchedIndex = normalizedTarget.indexOf(char, targetIndex);
        if (matchedIndex === -1) {
            return 0;
        }
        targetIndex = matchedIndex + 1;
    }

    return 20;
}

export function matchPresentationSearch(
    input: PresentationSearchInput,
    query: string,
): number {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
        return 0;
    }

    return Math.max(
        fuzzyScore(input.folder, normalizedQuery),
        fuzzyScore(input.title ?? '', normalizedQuery),
        fuzzyScore(input.author ?? '', normalizedQuery),
    );
}

export function toPresentationManifest(
    metadata: PresentationMetadata[],
    filter?: Partial<Pick<DevManifestEntry, 'canDev' | 'canBuild' | 'canExport'>>,
): DevManifestEntry[] {
    const entries = metadata.map((meta) => metadataToManifestEntry(meta));

    if (!filter) {
        return entries;
    }

    return entries.filter((entry) => {
        if (filter.canDev !== undefined && entry.canDev !== filter.canDev) {
            return false;
        }

        if (filter.canBuild !== undefined && entry.canBuild !== filter.canBuild) {
            return false;
        }

        if (filter.canExport !== undefined && entry.canExport !== filter.canExport) {
            return false;
        }

        return true;
    });
}

function metadataToManifestEntry(meta: PresentationMetadata): DevManifestEntry {
    const canDev = meta.availableActions.includes('dev');
    const canBuild = meta.availableActions.includes('build');
    const canExport = meta.availableActions.includes('export');

    const runType = meta.workspace && meta.scripts.dev ? 'workspace' : 'slides';
    const labelInput: PresentationLabelInput = {
        folder: meta.folder,
        workspace: meta.workspace,
        title: meta.title,
        date: meta.date,
        author: meta.author,
        run: {
            type: runType,
            workspace: meta.workspace ?? undefined,
            relativeSlidesPath: meta.relativeSlidesPath ?? undefined,
            action: 'dev',
        },
    };

    return {
        slug: toSlug(meta.folder, meta.workspace),
        folder: meta.folder,
        title: meta.title,
        workspace: meta.workspace,
        relativeSlidesPath: meta.relativeSlidesPath,
        date: meta.date,
        author: meta.author,
        canDev,
        canBuild,
        canExport,
        label: formatPresentationLabel(labelInput),
        key: createPresentationKey(labelInput),
    };
}

function stripWorkspaceScope(workspace: string): string {
    if (!workspace.includes('/')) {
        return workspace;
    }

    return workspace.split('/').pop() ?? workspace;
}
