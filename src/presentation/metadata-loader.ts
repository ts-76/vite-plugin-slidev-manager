import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getErrorMessage } from '../utils/process-utils.js';

export type PresentationAction = 'dev' | 'build' | 'export';
const presentationActions: PresentationAction[] = ['dev', 'build', 'export'];
const entryCandidates = ['slides.md', path.join('src', 'slides.md')];
const ignoredDirs = new Set(['_template', 'node_modules', '.git']);
const defaultDiscoveryDirs = ['presentations', 'decks', 'talks'];

interface PresentationPackageJson {
    name?: string;
    title?: string;
    displayName?: string;
    scripts?: Record<string, string>;
}

export interface PresentationMetadata {
    folder: string;
    presentationDir: string;
    workspace: string | null;
    scripts: Partial<Record<PresentationAction, string>>;
    availableActions: PresentationAction[];
    slidesPath: string | null;
    relativeSlidesPath: string | null;
    title: string | null;
    date: string | null;
    author: string | null;
}

interface DiscoveryEntry {
    folder: string;
    presentationDir: string;
    slidesPath: string | null;
}

interface SlidesFrontmatter {
    title: string | null;
    date: string | null;
    author: string | null;
}

export async function loadPresentationMetadata(
    root: string = process.cwd(),
    presentationsDir?: string,
): Promise<PresentationMetadata[]> {
    const discovered = await discoverPresentationEntries(root, presentationsDir);
    const metadata = await Promise.all(
        discovered.map((entry) => inspectPresentation(entry, root)),
    );

    return metadata.filter((entry): entry is PresentationMetadata => entry !== null);
}

async function discoverPresentationEntries(
    root: string,
    presentationsDir?: string,
): Promise<DiscoveryEntry[]> {
    const candidateBases = presentationsDir
        ? [presentationsDir]
        : defaultDiscoveryDirs.map((dir) => path.join(root, dir));

    for (const baseDir of candidateBases) {
        const entries = await findEntryFiles(baseDir);
        if (entries.length > 0) {
            return entries.sort(compareDiscoveryEntries);
        }
    }

    return [];
}

async function findEntryFiles(baseDir: string): Promise<DiscoveryEntry[]> {
    let entries: Dirent[];
    try {
        entries = await fs.readdir(baseDir, { withFileTypes: true });
    } catch (error: unknown) {
        if (hasErrorCode(error, 'ENOENT')) {
            return [];
        }

        throw error;
    }

    const discovered: DiscoveryEntry[] = [];

    for (const entry of entries) {
        if (!entry.isDirectory() || ignoredDirs.has(entry.name)) {
            continue;
        }

        const presentationDir = path.join(baseDir, entry.name);
        const slidesPath = await resolveSlidesPath(presentationDir);

        discovered.push({
            folder: entry.name,
            presentationDir,
            slidesPath,
        });
    }

    return discovered;
}

async function resolveSlidesPath(presentationDir: string): Promise<string | null> {
    for (const candidate of entryCandidates) {
        const filePath = path.join(presentationDir, candidate);
        if (await hasFile(filePath)) {
            return filePath;
        }
    }

    return null;
}

async function inspectPresentation(
    discovery: DiscoveryEntry,
    root: string,
): Promise<PresentationMetadata | null> {
    const packageJsonPath = path.join(discovery.presentationDir, 'package.json');
    const packageJson = await readPresentationPackageJson(packageJsonPath);
    if (!packageJson && !discovery.slidesPath) {
        return null;
    }

    const slidesMeta = discovery.slidesPath
        ? await readSlidesFrontmatter(discovery.slidesPath, discovery.folder)
        : { title: null, date: inferDateFromFolder(discovery.folder), author: null };
    const scripts = filterPresentationScripts(packageJson?.scripts ?? {});
    const availableActions = determineAvailableActions(scripts, Boolean(discovery.slidesPath));
    const titleFromPackage = packageJson?.title ?? packageJson?.displayName ?? null;

    return {
        folder: discovery.folder,
        presentationDir: discovery.presentationDir,
        workspace: packageJson?.name ?? null,
        scripts,
        availableActions,
        slidesPath: discovery.slidesPath,
        relativeSlidesPath: discovery.slidesPath ? path.relative(root, discovery.slidesPath) : null,
        title: titleFromPackage ?? slidesMeta.title,
        date: slidesMeta.date,
        author: slidesMeta.author,
    };
}

async function readSlidesFrontmatter(
    slidesPath: string,
    folder: string,
): Promise<SlidesFrontmatter> {
    try {
        const content = await fs.readFile(slidesPath, 'utf8');
        const lines = content.split(/\r?\n/);
        let inFrontmatter = false;
        let title: string | null = null;
        let date: string | null = inferDateFromFolder(folder);
        let author: string | null = null;

        for (let index = 0; index < lines.length; index += 1) {
            const trimmed = lines[index]?.trim() ?? '';

            if (index === 0 && trimmed === '---') {
                inFrontmatter = true;
                continue;
            }

            if (inFrontmatter) {
                if (trimmed === '---') {
                    inFrontmatter = false;
                    continue;
                }

                const field = parseFrontmatterField(trimmed);
                if (!field) {
                    continue;
                }

                if (field.key === 'title' && !title) {
                    title = field.value;
                }

                if (field.key === 'date' && !date) {
                    date = field.value;
                }

                if (field.key === 'author' && !author) {
                    author = field.value;
                }

                continue;
            }

            if (!trimmed) {
                continue;
            }

            if (!title) {
                const inlineField = parseFrontmatterField(trimmed);
                if (inlineField?.key === 'title') {
                    title = inlineField.value;
                    continue;
                }
            }

            if (!title && trimmed.startsWith('# ')) {
                const rawHeading = trimmed.slice(2).trim();
                title = rawHeading.replace(/<[^>]+>/g, '').trim() || null;
            }
        }

        return { title, date, author };
    } catch (error: unknown) {
        console.warn(
            `[selector] Failed to read metadata from ${slidesPath}: ${getErrorMessage(error)}`,
        );
        return {
            title: null,
            date: inferDateFromFolder(folder),
            author: null,
        };
    }
}

function parseFrontmatterField(line: string): { key: string; value: string | null } | null {
    const separator = line.indexOf(':');
    if (separator <= 0) {
        return null;
    }

    const key = line.slice(0, separator).trim().toLowerCase();
    const rawValue = line.slice(separator + 1).trim();
    const value = stripWrappingQuotes(rawValue);
    return { key, value: value || null };
}

function stripWrappingQuotes(value: string): string {
    if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
    ) {
        return value.slice(1, -1).trim();
    }

    return value;
}

function inferDateFromFolder(folder: string): string | null {
    const match = folder.match(/^(\d{4}-\d{2}(?:-\d{2})?)/);
    return match?.[1] ?? null;
}

function compareDiscoveryEntries(a: DiscoveryEntry, b: DiscoveryEntry): number {
    const aDate = inferDateFromFolder(a.folder);
    const bDate = inferDateFromFolder(b.folder);

    if (aDate && bDate && aDate !== bDate) {
        return bDate.localeCompare(aDate);
    }

    if (aDate && !bDate) {
        return -1;
    }

    if (!aDate && bDate) {
        return 1;
    }

    return a.folder.localeCompare(b.folder);
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

function isPresentationAction(value: string): value is PresentationAction {
    return presentationActions.includes(value as PresentationAction);
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function hasErrorCode(error: unknown, expectedCode: string): boolean {
    return isRecord(error) && error.code === expectedCode;
}
