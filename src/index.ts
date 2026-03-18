import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import { createLaunchContext, startDevServerBridge } from './dev-server-bridge.js';
import { rootDir } from './metadata-loader.js';
import type { PresentationAction, PresentationOption } from './presentation-selector.js';

const slidevCommands = ['dev', 'build', 'export'] as const;
const exportDefaultArgs = ['--timeout', '60000', '--wait-until', 'domcontentloaded'];

export interface PresentationManagerOptions {
    presentationsDir?: string;
    devArgs?: string[];
    buildArgs?: string[];
    exportArgs?: string[];
    defaultBuildCommand?: Extract<PresentationAction, 'build' | 'export'>;
}

interface SlidevInvocation {
    action: PresentationAction;
    args: string[];
}

export default function presentationManager(options: PresentationManagerOptions = {}): Plugin {
    return {
        name: 'presentation-manager',
        async configureServer(_server: ViteDevServer) {
            await runDevSelector(resolveInvocation('dev', options), options);
        },
        async buildStart() {
            if (!process.argv.includes('build')) {
                return;
            }

            await runBuildSelector(
                resolveInvocation(options.defaultBuildCommand ?? 'build', options),
                options,
            );
            process.exit(0);
        },
    };
}

async function runDevSelector(
    invocation: SlidevInvocation,
    pluginOptions: PresentationManagerOptions,
) {
    try {
        const { selectPresentation } = await import('./presentation-selector.js');

        const presentationsDir = pluginOptions.presentationsDir
            ? path.resolve(rootDir, pluginOptions.presentationsDir)
            : undefined;

        const { options, selected, cancelled } = await selectPresentation({
            action: invocation.action,
            heading: getHeading(invocation.action),
            helpText: getHelpText(invocation.action),
            presentationsDir,
        });

        if (options.length === 0) {
            console.error(
                `No Slidev presentations with a ${invocation.action} entrypoint were found.`,
            );
            process.exit(1);
            return;
        }

        if (cancelled || !selected) {
            process.exit(0);
            return;
        }

        const context = createLaunchContext(selected, options, invocation.args);
        const bridge = await startDevServerBridge(context);

        process.once('SIGINT', async () => {
            await bridge.stop();
            process.exit(0);
        });

        process.once('SIGTERM', async () => {
            await bridge.stop();
            process.exit(0);
        });

        await new Promise<void>(() => {});
    } catch (error: unknown) {
        console.error('Failed to run presentation selector:', getErrorMessage(error));
        process.exit(1);
    }
}

async function runBuildSelector(
    invocation: SlidevInvocation,
    pluginOptions: PresentationManagerOptions,
) {
    try {
        const { selectPresentation } = await import('./presentation-selector.js');

        const { options, selected, cancelled } = await selectPresentation({
            action: invocation.action,
            heading: getHeading(invocation.action),
            helpText: getHelpText(invocation.action),
            presentationsDir: pluginOptions.presentationsDir
                ? path.resolve(rootDir, pluginOptions.presentationsDir)
                : undefined,
        });

        if (options.length === 0) {
            console.error(
                `No Slidev presentations with a ${invocation.action} entrypoint were found.`,
            );
            return;
        }

        if (cancelled || !selected) {
            return;
        }

        await runCommand(selected, invocation);
    } catch (error: unknown) {
        console.error('Failed to run presentation selector:', getErrorMessage(error));
    }
}

async function runCommand(selection: PresentationOption, invocation: SlidevInvocation) {
    const require = createRequire(import.meta.url);
    const slidevPath = require.resolve('@slidev/cli/bin/slidev.mjs');
    const absoluteSlidesPath = selection.slidesPath;

    if (!absoluteSlidesPath) {
        console.error('Could not determine slides path for selection');
        return 1;
    }

    const cwd = path.dirname(absoluteSlidesPath);
    const slidesArg = path.basename(absoluteSlidesPath);
    const commandArgs = [slidevPath, invocation.action, slidesArg, ...invocation.args];

    return new Promise<number>((resolve) => {
        const child = spawn('node', commandArgs, {
            cwd,
            stdio: 'inherit',
            env: {
                ...process.env,
                NODE_ENV: invocation.action === 'dev' ? 'development' : 'production',
            },
        });

        child.on('exit', (code) => {
            resolve(code ?? 0);
        });

        child.on('error', (error) => {
            console.error(`Failed to start ${invocation.action}:`, error.message);
            resolve(1);
        });
    });
}

export function resolveInvocation(
    defaultAction: PresentationAction,
    options: PresentationManagerOptions,
    argv: string[] = process.argv,
): SlidevInvocation {
    const cliArgs = extractSlidevCliArgs(argv);
    const [commandOverride, ...remainingArgs] = cliArgs;
    const action = isPresentationAction(commandOverride) ? commandOverride : defaultAction;
    const userArgs = isPresentationAction(commandOverride) ? remainingArgs : cliArgs;

    return {
        action,
        args: mergeDefaultArgs(action, options, userArgs),
    };
}

function extractSlidevCliArgs(argv: string[]): string[] {
    const separatorIndex = argv.indexOf('--');
    if (separatorIndex === -1) {
        return [];
    }

    return argv.slice(separatorIndex + 1);
}

function mergeDefaultArgs(
    action: PresentationAction,
    options: PresentationManagerOptions,
    userArgs: string[],
): string[] {
    const configuredArgs = getConfiguredArgs(action, options);
    const defaults = getDefaultArgs(action);
    const mergedArgs = [...configuredArgs, ...defaults];

    for (const arg of userArgs) {
        if (!mergedArgs.includes(arg)) {
            mergedArgs.push(arg);
        }
    }

    return mergedArgs;
}

function getConfiguredArgs(
    action: PresentationAction,
    options: PresentationManagerOptions,
): string[] {
    if (action === 'dev') {
        return options.devArgs ?? [];
    }

    if (action === 'build') {
        return options.buildArgs ?? [];
    }

    return options.exportArgs ?? [];
}

function getDefaultArgs(action: PresentationAction): string[] {
    if (action === 'dev') {
        return ['--open'];
    }

    if (action === 'export') {
        return [...exportDefaultArgs];
    }

    return [];
}

function getHeading(action: PresentationAction): string {
    if (action === 'dev') {
        return 'Select a Slidev presentation to run';
    }

    if (action === 'build') {
        return 'Select a Slidev presentation to build';
    }

    return 'Select a Slidev presentation to export';
}

function getHelpText(action: PresentationAction): string {
    if (action === 'dev') {
        return 'Use arrow keys to pick a presentation, press Enter to launch, or Q to cancel.';
    }

    if (action === 'build') {
        return 'Use arrow keys to pick a presentation, press Enter to build, or Q to cancel.';
    }

    return 'Use arrow keys to pick a presentation, press Enter to export, or Q to cancel.';
}

function isPresentationAction(value: string | undefined): value is PresentationAction {
    return slidevCommands.includes(value as PresentationAction);
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
