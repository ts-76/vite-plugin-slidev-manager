import type { PresentationAction } from '../selector/presentation-selector.js';
import type { PresentationManagerOptions } from '../index.js';

const browserExportFlag = '--export';
const exportDefaultArgs = ['--timeout', '60000', '--wait-until', 'domcontentloaded'];

export interface SlidevInvocation {
    action: PresentationAction;
    args: string[];
    browserExport: boolean;
}

export function resolveInvocation(
    defaultAction: PresentationAction,
    options: PresentationManagerOptions,
    argv: string[] = process.argv,
): SlidevInvocation {
    const cliArgs = extractSlidevCliArgs(argv);
    const browserExport = cliArgs.includes(browserExportFlag);
    const userArgs = browserExport ? cliArgs.filter((arg) => arg !== browserExportFlag) : cliArgs;
    const action = browserExport ? 'export' : defaultAction;

    return {
        action,
        args: mergeDefaultArgs(action, options, userArgs),
        browserExport,
    };
}

export function extractSlidevCliArgs(argv: string[]): string[] {
    const separatorIndex = argv.indexOf('--');
    if (separatorIndex !== -1) {
        return argv.slice(separatorIndex + 1);
    }

    return [];
}

function mergeDefaultArgs(
    action: PresentationAction,
    options: PresentationManagerOptions,
    userArgs: string[],
): string[] {
    const configuredArgs = getConfiguredArgs(action, options);
    const defaults = getDefaultArgs(action);
    return [...configuredArgs, ...defaults, ...userArgs];
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

export function convertExportArgsToDevArgs(args: string[]): string[] {
    const devArgs: string[] = [];

    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];
        if (!arg) {
            continue;
        }

        if (arg === '--timeout' || arg === '--wait-until' || arg === '--waitUntil') {
            index += 1;
            continue;
        }

        if (
            arg.startsWith('--timeout=') ||
            arg.startsWith('--wait-until=') ||
            arg.startsWith('--waitUntil=')
        ) {
            continue;
        }

        devArgs.push(arg);
    }

    return devArgs;
}
