import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

export const rootDir = process.cwd();

export type PresentationAction = 'dev' | 'build' | 'export';
const presentationActions: PresentationAction[] = ['dev', 'build', 'export'];

interface PresentationPackageJson {
    name?: string;
    title?: string;
    displayName?: string;
    scripts?: Record<string, string>;
}

export interface PresentationMetadata {
    folder: string;
    workspace: string | null;
    scripts: Partial<Record<PresentationAction, string>>;
    availableActions: PresentationAction[];
    slidesPath: string | null;
    relativeSlidesPath: string | null;
    title: string | null;
}

export async function loadPresentationMetadata(
    root: string = process.cwd(),
    presentationsDir: string = path.join(root, 'presentations'),
): Promise<PresentationMetadata[]> {
    let entries: Dirent[];
    try {
        entries = await fs.readdir(presentationsDir, { withFileTypes: true });
    } catch (error: unknown) {
        if (hasErrorCode(error, 'ENOENT')) {
            return [];
        }

        throw error;
    }

    const metadata: PresentationMetadata[] = [];

    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }

        const meta = await inspectPresentation(entry.name, presentationsDir, root);
        if (meta) {
            metadata.push(meta);
        }
    }

    metadata.sort((a, b) => a.folder.localeCompare(b.folder));
    return metadata;
}

async function inspectPresentation(
    folder: string,
    presentationsDir: string,
    root: string,
): Promise<PresentationMetadata | null> {
    const presentationDir = path.join(presentationsDir, folder);
    const packageJsonPath = path.join(presentationDir, 'package.json');
    const slidesPath = path.join(presentationDir, 'slides.md');

    const packageJson = await readPresentationPackageJson(packageJsonPath);
    const slidesExists = await hasFile(slidesPath);

    if (!packageJson && !slidesExists) {
        return null;
    }

    const titleFromPackage = packageJson?.title ?? packageJson?.displayName ?? null;
    const title =
        titleFromPackage ?? (slidesExists ? await inferTitleFromSlides(slidesPath) : null);
    const scripts = filterPresentationScripts(packageJson?.scripts ?? {});
    const availableActions = determineAvailableActions(scripts, slidesExists);

    return {
        folder,
        workspace: packageJson?.name ?? null,
        scripts,
        availableActions,
        slidesPath: slidesExists ? slidesPath : null,
        relativeSlidesPath: slidesExists ? path.relative(root, slidesPath) : null,
        title,
    };
}

async function readPresentationPackageJson(
    packageJsonPath: string,
): Promise<PresentationPackageJson | null> {
    try {
        const raw = await fs.readFile(packageJsonPath, 'utf8');
        return parsePresentationPackageJson(JSON.parse(raw));
    } catch (error: unknown) {
        if (!hasErrorCode(error, 'ENOENT')) {
            console.warn(`[selector] Failed to read ${packageJsonPath}: ${getErrorMessage(error)}`);
        }

        return null;
    }
}

async function hasFile(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch (error: unknown) {
        if (!hasErrorCode(error, 'ENOENT')) {
            console.warn(`[selector] Failed to check ${filePath}: ${getErrorMessage(error)}`);
        }

        return false;
    }
}

function parsePresentationPackageJson(value: unknown): PresentationPackageJson {
    if (!isRecord(value)) {
        return {};
    }

    const scripts = isRecord(value.scripts)
        ? Object.fromEntries(
              Object.entries(value.scripts).filter(
                  (entry): entry is [string, string] => typeof entry[1] === 'string',
              ),
          )
        : undefined;

    return {
        name: typeof value.name === 'string' ? value.name : undefined,
        title: typeof value.title === 'string' ? value.title : undefined,
        displayName: typeof value.displayName === 'string' ? value.displayName : undefined,
        scripts,
    };
}

function filterPresentationScripts(
    scripts: Record<string, string>,
): Partial<Record<PresentationAction, string>> {
    return Object.fromEntries(
        Object.entries(scripts).filter(
            (entry): entry is [PresentationAction, string] =>
                isPresentationAction(entry[0]) && typeof entry[1] === 'string',
        ),
    );
}

function determineAvailableActions(
    scripts: Partial<Record<PresentationAction, string>>,
    slidesExists: boolean,
): PresentationAction[] {
    return presentationActions.filter((action) => slidesExists || Boolean(scripts[action]));
}

async function inferTitleFromSlides(slidesPath: string): Promise<string | null> {
    try {
        const content = await fs.readFile(slidesPath, 'utf8');
        const lines = content.split(/\r?\n/);

        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) {
                continue;
            }

            if (trimmed.startsWith('title:')) {
                return trimmed.slice('title:'.length).trim() || null;
            }

            if (trimmed.startsWith('# ')) {
                return trimmed.slice(2).trim() || null;
            }
        }
    } catch (error: unknown) {
        console.warn(
            `[selector] Failed to read title from ${slidesPath}: ${getErrorMessage(error)}`,
        );
    }

    return null;
}

function isPresentationAction(value: string): value is PresentationAction {
    return presentationActions.includes(value as PresentationAction);
}

function hasErrorCode(error: unknown, code: string): boolean {
    return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    if (
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof error.message === 'string'
    ) {
        return error.message;
    }

    return String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}
