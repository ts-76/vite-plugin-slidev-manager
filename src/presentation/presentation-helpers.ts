import type { PresentationAction, PresentationMetadata } from './metadata-loader.js';

export interface PresentationLabelInput {
    folder: string;
    workspace: string | null;
    title: string | null;
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
    canDev: boolean;
    canBuild: boolean;
    canExport: boolean;
    label: string;
    key: string;
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
    const workspaceName = input.workspace ?? '';
    const slugFromWorkspace = workspaceName.includes('/')
        ? workspaceName.split('/').pop()
        : workspaceName;

    const baseTitle = input.title ?? input.folder;
    const detail =
        input.run.type === 'workspace' ? workspaceName : (input.run.relativeSlidesPath ?? '');

    if (
        input.run.type === 'workspace' &&
        input.title &&
        slugFromWorkspace &&
        input.title !== slugFromWorkspace
    ) {
        return `${baseTitle} (${slugFromWorkspace})`;
    }

    if (input.run.type === 'workspace' && slugFromWorkspace && slugFromWorkspace !== input.folder) {
        return `${input.folder} (${workspaceName})`;
    }

    return `${baseTitle} (${detail})`;
}

export function createPresentationKey(input: PresentationLabelInput): string {
    const { action } = input.run;
    const detail =
        input.run.type === 'workspace'
            ? (input.run.workspace ?? input.folder)
            : (input.run.relativeSlidesPath ?? '');
    return `${action}::${input.folder}::${input.run.type}::${detail}`;
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
