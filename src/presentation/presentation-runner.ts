import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { PresentationAction } from './metadata-loader.js';
import type { PresentationOption } from '../selector/presentation-selector.js';

export interface SpawnSpec {
    command: string;
    args: string[];
    cwd: string;
    env: NodeJS.ProcessEnv;
    stdio?: 'inherit' | ['inherit', 'pipe', 'pipe'];
}

interface PackageManagerSpec {
    command: string;
    runArgs: string[];
    supportsDoubleDash: boolean;
}

const packageManagerOrder = [
    { command: 'bun', lockFile: 'bun.lock' },
    { command: 'bun', lockFile: 'bun.lockb' },
    { command: 'pnpm', lockFile: 'pnpm-lock.yaml' },
    { command: 'yarn', lockFile: 'yarn.lock' },
    { command: 'npm', lockFile: 'package-lock.json' },
    { command: 'npm', lockFile: 'npm-shrinkwrap.json' },
] as const;

export async function createDevSpawnSpec(
    selection: PresentationOption,
    args: string[],
    port: number,
): Promise<SpawnSpec> {
    const devArgs = replacePortArg(removeOpenArg(args), port);
    const env = {
        ...process.env,
        NODE_ENV: 'development',
    };

    if (selection.run.type === 'workspace') {
        const packageManager = await detectPackageManager(selection.presentationDir);
        return {
            command: packageManager.command,
            args: buildPackageManagerArgs(packageManager, 'dev', devArgs),
            cwd: selection.presentationDir,
            env,
        };
    }

    const absoluteSlidesPath = selection.run.slidesPath ?? selection.slidesPath;
    if (!absoluteSlidesPath) {
        throw new Error(`Could not determine slides path for "${selection.folder}"`);
    }

    const require = createRequire(import.meta.url);
    const slidevPath = require.resolve('@slidev/cli/bin/slidev.mjs');

    return {
        command: 'node',
        args: [slidevPath, path.basename(absoluteSlidesPath), ...devArgs],
        cwd: path.dirname(absoluteSlidesPath),
        env,
    };
}

export async function runPresentationAction(
    selection: PresentationOption,
    action: Exclude<PresentationAction, 'dev'>,
    args: string[],
): Promise<number> {
    const spec = await createActionSpawnSpec(selection, action, args);

    return new Promise<number>((resolve) => {
        const child = spawn(spec.command, spec.args, {
            cwd: spec.cwd,
            stdio: 'inherit',
            env: spec.env,
        });

        child.on('exit', (code) => {
            resolve(code ?? 0);
        });

        child.on('error', (error) => {
            console.error(`Failed to start ${action}:`, error.message);
            resolve(1);
        });
    });
}

export function spawnWithSpec(spec: SpawnSpec): ChildProcess {
    return spawn(spec.command, spec.args, {
        cwd: spec.cwd,
        stdio: spec.stdio ?? 'inherit',
        env: spec.env,
    });
}

export function resolvePort(args: string[]): number {
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];

        if (!arg) {
            continue;
        }

        if (arg === '--port' || arg === '-p') {
            return parsePortValue(args[index + 1]);
        }

        if (arg.startsWith('--port=')) {
            return parsePortValue(arg.slice('--port='.length));
        }

        if (arg.startsWith('-p') && arg.length > 2) {
            return parsePortValue(arg.slice(2));
        }
    }

    return 3030;
}

function parsePortValue(value: string | undefined): number {
    const parsed = Number.parseInt(value ?? '3030', 10);
    return Number.isNaN(parsed) ? 3030 : parsed;
}

export function resolveBasePath(args: string[]): string {
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];

        if (!arg) {
            continue;
        }

        if (arg === '--base') {
            return normalizeBasePath(args[index + 1] ?? '/');
        }

        if (arg.startsWith('--base=')) {
            return normalizeBasePath(arg.slice('--base='.length) || '/');
        }
    }

    return '/';
}

export function shouldOpenBrowser(args: string[]): boolean {
    return args.some((arg) => arg === '--open' || arg.startsWith('--open='));
}

export async function reservePort(): Promise<number> {
    const server = await import('node:net').then(({ createServer }) => createServer());

    return new Promise<number>((resolve, reject) => {
        server.listen(0, '127.0.0.1', () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                reject(new Error('Could not reserve a port'));
                return;
            }

            const port = address.port;
            server.close((error) => {
                if (error) {
                    reject(error);
                    return;
                }

                resolve(port);
            });
        });

        server.on('error', reject);
    });
}

export async function waitForHttpReady(url: string, timeoutMs: number = 20000): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    const candidates = getLocalUrlCandidates(url);

    while (Date.now() < deadline) {
        for (const candidate of candidates) {
            try {
                await fetch(candidate, {
                    method: 'GET',
                    headers: {
                        Accept: 'text/html,application/json;q=0.9,*/*;q=0.8',
                    },
                });

                return;
            } catch {
                // Server is still starting.
            }
        }

        await new Promise((resolve) => setTimeout(resolve, 250));
    }

    throw new Error(`Timed out waiting for dev server at ${url}`);
}

export async function openBrowser(url: string): Promise<void> {
    const command =
        process.platform === 'win32'
            ? { file: 'cmd', args: ['/c', 'start', '', url] }
            : process.platform === 'darwin'
              ? { file: 'open', args: [url] }
              : { file: 'xdg-open', args: [url] };

    await new Promise<void>((resolve, reject) => {
        const child = spawn(command.file, command.args, {
            stdio: 'ignore',
            detached: true,
        });

        child.on('error', reject);
        child.unref();
        resolve();
    });
}

async function createActionSpawnSpec(
    selection: PresentationOption,
    action: Exclude<PresentationAction, 'dev'>,
    args: string[],
): Promise<SpawnSpec> {
    const env = {
        ...process.env,
    };

    if (action === 'build') {
        env.NODE_ENV = 'production';
    }

    if (selection.run.type === 'workspace') {
        const packageManager = await detectPackageManager(selection.presentationDir);
        return {
            command: packageManager.command,
            args: buildPackageManagerArgs(packageManager, action, args),
            cwd: selection.presentationDir,
            env,
        };
    }

    const absoluteSlidesPath = selection.run.slidesPath ?? selection.slidesPath;
    if (!absoluteSlidesPath) {
        throw new Error('Could not determine slides path for selection');
    }

    const require = createRequire(import.meta.url);
    const slidevPath = require.resolve('@slidev/cli/bin/slidev.mjs');

    return {
        command: 'node',
        args: [slidevPath, action, path.basename(absoluteSlidesPath), ...args],
        cwd: path.dirname(absoluteSlidesPath),
        env,
    };
}

async function detectPackageManager(startDir: string): Promise<PackageManagerSpec> {
    for (const dirPath of walkUpDirectories(startDir)) {
        const packageManager = await readPackageManagerField(dirPath);
        if (packageManager) {
            return packageManager;
        }

        for (const candidate of packageManagerOrder) {
            if (await fileExists(path.join(dirPath, candidate.lockFile))) {
                return toPackageManagerSpec(candidate.command);
            }
        }
    }

    return toPackageManagerSpec('npm');
}

async function readPackageManagerField(dirPath: string): Promise<PackageManagerSpec | null> {
    const packageJsonPath = path.join(dirPath, 'package.json');

    try {
        const raw = await fs.readFile(packageJsonPath, 'utf8');
        const value = JSON.parse(raw);

        if (
            typeof value !== 'object' ||
            value === null ||
            !('packageManager' in value) ||
            typeof value.packageManager !== 'string'
        ) {
            return null;
        }

        const manager = value.packageManager.split('@')[0] ?? '';
        return manager ? toPackageManagerSpec(manager) : null;
    } catch (error: unknown) {
        if (isErrnoException(error) && error.code === 'ENOENT') {
            return null;
        }

        throw error;
    }
}

function walkUpDirectories(startDir: string): string[] {
    const visited: string[] = [];
    let current = path.resolve(startDir);

    while (!visited.includes(current)) {
        visited.push(current);
        const parent = path.dirname(current);
        if (parent === current) {
            break;
        }
        current = parent;
    }

    return visited;
}

function toPackageManagerSpec(command: string): PackageManagerSpec {
    if (command === 'yarn') {
        return {
            command,
            runArgs: ['run'],
            supportsDoubleDash: false,
        };
    }

    if (command === 'pnpm' || command === 'bun' || command === 'npm') {
        return {
            command,
            runArgs: ['run'],
            supportsDoubleDash: true,
        };
    }

    return {
        command: 'npm',
        runArgs: ['run'],
        supportsDoubleDash: true,
    };
}

function buildPackageManagerArgs(
    packageManager: PackageManagerSpec,
    action: PresentationAction,
    args: string[],
): string[] {
    const commandArgs = [...packageManager.runArgs, action];

    if (args.length === 0) {
        return commandArgs;
    }

    if (packageManager.supportsDoubleDash) {
        return [...commandArgs, '--', ...args];
    }

    return [...commandArgs, ...args];
}

function removeOpenArg(args: string[]): string[] {
    return args.filter((arg) => arg !== '--open' && !arg.startsWith('--open='));
}

function replacePortArg(args: string[], port: number): string[] {
    const result: string[] = [];

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];

        if (arg === '--port' || arg === '-p') {
            index += 1;
            continue;
        }

        if (arg.startsWith('--port=') || (arg.startsWith('-p') && arg.length > 2)) {
            continue;
        }

        result.push(arg);
    }

    result.push('--port', String(port));
    return result;
}

function normalizeBasePath(basePath: string): string {
    if (!basePath.startsWith('/')) {
        return `/${basePath}`;
    }

    return basePath;
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
    return typeof error === 'object' && error !== null && 'code' in error;
}

async function fileExists(filePath: string): Promise<boolean> {
    try {
        await fs.access(filePath);
        return true;
    } catch (error: unknown) {
        if (isErrnoException(error) && error.code === 'ENOENT') {
            return false;
        }

        throw error;
    }
}

function getLocalUrlCandidates(url: string): string[] {
    const parsed = new URL(url);
    const candidates = [parsed.toString()];

    if (parsed.hostname === '127.0.0.1') {
        parsed.hostname = 'localhost';
        candidates.push(parsed.toString());
    } else if (parsed.hostname === 'localhost') {
        parsed.hostname = '127.0.0.1';
        candidates.push(parsed.toString());
    }

    return candidates;
}
