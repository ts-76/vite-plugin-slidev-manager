import path from 'node:path';
import { createLaunchContext, startDevServerBridge } from '../bridge/dev-server-bridge.js';
import type { SlidevInvocation } from '../invocation/index.js';
import { convertExportArgsToDevArgs } from '../invocation/index.js';
import { getErrorMessage, restoreTerminalInput } from '../utils/process-utils.js';
import { openBrowser, runPresentationAction } from '../presentation/presentation-runner.js';
import type { PresentationOption } from './presentation-selector.js';
import { registerBridgeShutdown } from './bridge-shutdown.js';
import { resolveSelection } from './selection.js';
import { getHeading, getHelpText } from './ui-copy.js';
import type { PresentationManagerOptions } from '../index.js';

const presentationEnvVar = 'SLIDEV_MANAGER_PRESENTATION';

export async function runDevSelector(
    invocation: SlidevInvocation,
    pluginOptions: PresentationManagerOptions,
    viteRoot: string = process.cwd(),
) {
    try {
        const { selectPresentation } = await import('./presentation-selector.js');
        const preselectedFolder = readPreselectedPresentation();
        const selection = await selectPresentation({
            action: invocation.action,
            heading: getHeading(invocation.action),
            helpText: getHelpText(invocation.action),
            projectRoot: viteRoot,
            presentationsDir: resolvePresentationsDir(pluginOptions, viteRoot),
            preselectedFolder,
        });

        restoreTerminalInput();

        const { options, selected, cancelled } = selection;
        if (options.length === 0) {
            console.error(
                `No Slidev presentations with a ${invocation.action} entrypoint were found.`,
            );
            process.exit(1);
        }

        if (cancelled || !selected) {
            process.exit(0);
        }

        const bridge = await startDevServerBridge(
            createLaunchContext(
                selected,
                options,
                viteRoot,
                invocation.args,
                invocation.browserExport
                    ? convertExportArgsToDevArgs(invocation.args)
                    : invocation.args,
            ),
        );

        registerBridgeShutdown(bridge);

        if (invocation.browserExport) {
            try {
                await openBrowser(`http://localhost:${bridge.bridgePort}/export`);
                console.log(
                    `Opened browser exporter at http://localhost:${bridge.bridgePort}/export`,
                );
            } catch (error: unknown) {
                console.error('Failed to open browser exporter:', getErrorMessage(error));
                await bridge.stop();
                process.exit(1);
            }
        }

        const cleanupShortcutHandler = installSwitchShortcutHandler({
            bridge,
            viteRoot,
            invocation,
            pluginOptions,
        });

        const exitCode = await bridge.waitUntilStopped();
        cleanupShortcutHandler();
        process.exit(exitCode);
    } catch (error: unknown) {
        console.error('Failed to run presentation selector:', getErrorMessage(error));
        process.exit(1);
    }
}

export async function runBuildSelector(
    invocation: SlidevInvocation,
    pluginOptions: PresentationManagerOptions,
    viteRoot: string = process.cwd(),
): Promise<number> {
    try {
        const { selectPresentation } = await import('./presentation-selector.js');
        const preselectedFolder = readPreselectedPresentation();
        const selection = await selectPresentation({
            action: invocation.action,
            heading: getHeading(invocation.action),
            helpText: getHelpText(invocation.action),
            projectRoot: viteRoot,
            presentationsDir: resolvePresentationsDir(pluginOptions, viteRoot),
            preselectedFolder,
        });

        restoreTerminalInput();

        const selected = resolveSelection(selection, invocation.action, preselectedFolder);
        if (!selected) {
            return 0;
        }

        return await runCommand(selected, invocation, viteRoot);
    } catch (error: unknown) {
        console.error('Failed to run presentation selector:', getErrorMessage(error));
        return 1;
    }
}

async function runCommand(
    selection: PresentationOption,
    invocation: SlidevInvocation,
    viteRoot: string,
) {
    if (invocation.action === 'dev') {
        throw new Error('runCommand does not support dev invocations');
    }

    if (invocation.browserExport) {
        return runBrowserExport(selection, invocation.args, viteRoot);
    }

    return runPresentationAction(selection, invocation.action, invocation.args);
}

async function runBrowserExport(
    selection: PresentationOption,
    args: string[],
    viteRoot: string,
): Promise<number> {
    const bridge = await startDevServerBridge(
        createLaunchContext(
            selection,
            [selection],
            viteRoot,
            args,
            convertExportArgsToDevArgs(args),
        ),
    );

    registerBridgeShutdown(bridge);

    try {
        await openBrowser(`http://localhost:${bridge.bridgePort}/export`);
        console.log(`Opened browser exporter at http://localhost:${bridge.bridgePort}/export`);
    } catch (error: unknown) {
        console.error('Failed to open browser exporter:', getErrorMessage(error));
        await bridge.stop();
        return 1;
    }

    return bridge.waitUntilStopped();
}

function readPreselectedPresentation(): string | undefined {
    const value = process.env[presentationEnvVar]?.trim();
    return value ? value : undefined;
}

export function resolvePresentationsDir(
    pluginOptions: PresentationManagerOptions,
    viteRoot: string,
): string | undefined {
    return pluginOptions.presentationsDir
        ? path.resolve(viteRoot, pluginOptions.presentationsDir)
        : undefined;
}

function installSwitchShortcutHandler({
    bridge,
    viteRoot,
    invocation,
    pluginOptions,
}: {
    bridge: {
        switchDeck: (folder: string) => Promise<{ success: boolean; folder: string; error?: string }>;
        currentFolder: string;
    };
    viteRoot: string;
    invocation: SlidevInvocation;
    pluginOptions: PresentationManagerOptions;
}): () => void {
    if (!process.stdin.isTTY) {
        return () => {};
    }

    let switching = false;

    const onData = (chunk: Buffer) => {
        if (switching) {
            return;
        }

        const input = chunk.toString();
        if (!input.includes('\x13')) {
            return;
        }

        switching = true;
        console.log('\n[slidev-manager] Ctrl-s detected — opening deck selector...');

        cleanup();

        void handleSwitchShortcut(bridge, viteRoot, invocation, pluginOptions).finally(() => {
            install();
            switching = false;
        });
    };

    const install = () => {
        if (!process.stdin.isTTY) {
            return;
        }
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.on('data', onData);
    };

    const cleanup = () => {
        process.stdin.off('data', onData);
        if (typeof process.stdin.setRawMode === 'function') {
            process.stdin.setRawMode(false);
        }
    };

    install();
    return cleanup;
}

async function handleSwitchShortcut(
    bridge: { switchDeck: (folder: string) => Promise<{ success: boolean; folder: string; error?: string }>; currentFolder: string },
    viteRoot: string,
    invocation: SlidevInvocation,
    pluginOptions: PresentationManagerOptions,
): Promise<void> {
    try {
        const { selectPresentation } = await import('./presentation-selector.js');
        const selection = await selectPresentation({
            action: invocation.action,
            heading: 'Switch deck',
            helpText: 'Select a new deck or press Esc to cancel.',
            projectRoot: viteRoot,
            presentationsDir: resolvePresentationsDir(pluginOptions, viteRoot),
        });

        restoreTerminalInput();

        if (selection.cancelled || !selection.selected) {
            console.log('\n[slidev-manager] Switch cancelled.');
            return;
        }

        if (selection.selected.folder === bridge.currentFolder) {
            console.log(`\n[slidev-manager] "${selection.selected.folder}" is already running.`);
            return;
        }

        const result = await bridge.switchDeck(selection.selected.folder);
        if (result.success) {
            console.log(`\n[slidev-manager] Switched to "${result.folder}".`);
        } else {
            console.error(`\n[slidev-manager] Switch failed: ${result.error}`);
        }
    } catch (error: unknown) {
        console.error(`\n[slidev-manager] Switch error: ${getErrorMessage(error)}`);
    }
}
