import type { Dirent } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

export const rootDir = process.cwd();

export interface PresentationMetadata {
    folder: string;
    workspace: string | null;
    scripts: Record<string, string>;
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
        // biome-ignore lint/suspicious/noExplicitAny: Error handling
        if ((error as any).code === 'ENOENT') {
            return [];
        }
        throw error;
    }

    const metadata: PresentationMetadata[] = [];

    for (const entry of entries) {
        if (!entry.isDirectory()) {
            continue;
        }

        const meta = await inspectPresentation(
            entry.name,
            presentationsDir,
            root,
        );
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

    // biome-ignore lint/suspicious/noExplicitAny: JSON content is untyped
    let packageJson: Record<string, any> | null = null;
    try {
        const raw = await fs.readFile(packageJsonPath, 'utf8');
        packageJson = JSON.parse(raw);
    } catch (error: unknown) {
        // biome-ignore lint/suspicious/noExplicitAny: Error handling
        if ((error as any).code !== 'ENOENT') {
            console.warn(
                // biome-ignore lint/suspicious/noExplicitAny: Error handling
                `[selector] Failed to read ${packageJsonPath}: ${(error as any).message}`,
            );
        }
    }

    let slidesExists = false;
    try {
        await fs.access(slidesPath);
        slidesExists = true;
    } catch (error: unknown) {
        // biome-ignore lint/suspicious/noExplicitAny: Error handling
        if ((error as any).code !== 'ENOENT') {
            console.warn(
                // biome-ignore lint/suspicious/noExplicitAny: Error handling
                `[selector] Failed to check ${slidesPath}: ${(error as any).message}`,
            );
        }
    }

    if (!packageJson && !slidesExists) {
        return null;
    }

    const titleFromPackage =
        packageJson?.title ?? packageJson?.displayName ?? null;
    const title =
        titleFromPackage ??
        (slidesExists ? await inferTitleFromSlides(slidesPath) : null);

    return {
        folder,
        workspace: packageJson?.name ?? null,
        scripts: packageJson?.scripts ?? {},
        slidesPath: slidesExists ? slidesPath : null,
        relativeSlidesPath: slidesExists
            ? path.relative(root, slidesPath)
            : null,
        title,
    };
}

async function inferTitleFromSlides(
    slidesPath: string,
): Promise<string | null> {
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
            // biome-ignore lint/suspicious/noExplicitAny: Error handling
            `[selector] Failed to read title from ${slidesPath}: ${(error as any).message}`,
        );
    }

    return null;
}
