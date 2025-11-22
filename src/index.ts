import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
import type { Plugin, ViteDevServer } from 'vite';
import { rootDir } from './metadata-loader.js';
import type { PresentationOption } from './presentation-selector.js';

export interface PresentationManagerOptions {
    presentationsDir?: string;
}

export default function presentationManager(
    options: PresentationManagerOptions = {},
): Plugin {
    return {
        name: 'presentation-manager',
        async configureServer(_server: ViteDevServer) {
            await runSelector('dev', options);
            process.exit(0);
        },
        async buildStart() {
            if (
                (process.env.NODE_ENV === 'production' ||
                    process.argv.includes('build')) &&
                !process.argv.includes('export')
            ) {
                await runSelector('export', options);
                process.exit(0);
            }
        },
    };
}

async function runSelector(
    action: 'dev' | 'export',
    pluginOptions: PresentationManagerOptions,
) {
    try {
        const { selectPresentation } = await import(
            './presentation-selector.js'
        );

        const { options, selected, cancelled } = await selectPresentation({
            action: action,
            heading:
                action === 'dev'
                    ? 'Select a Slidev presentation to run'
                    : 'Select a Slidev presentation to export',
            helpText:
                action === 'dev'
                    ? 'Use arrow keys to pick a presentation, press Enter to launch, or Q to cancel.'
                    : 'Use arrow keys to pick a presentation, press Enter to export, or Q to cancel.',
            presentationsDir: pluginOptions.presentationsDir
                ? path.resolve(rootDir, pluginOptions.presentationsDir)
                : undefined,
        });

        if (options.length === 0) {
            console.error(
                `No Slidev presentations with a ${action} entrypoint were found.`,
            );
            return;
        }

        if (cancelled || !selected) {
            return;
        }

        await runCommand(selected, action);
    } catch (error: unknown) {
        console.error(
            'Failed to run presentation selector:',
            // biome-ignore lint/suspicious/noExplicitAny: Error handling
            (error as any).message,
        );
    }
}

async function runCommand(
    selection: PresentationOption,
    action: 'dev' | 'export',
) {
    const require = createRequire(import.meta.url);
    const slidevPath = require.resolve('@slidev/cli/bin/slidev.mjs');

    let command: { file: string; args: string[] };

    const absoluteSlidesPath = selection.slidesPath;

    if (!absoluteSlidesPath) {
        console.error('Could not determine slides path for selection');
        return 1;
    }

    const cwd = path.dirname(absoluteSlidesPath);
    const slidesArg = path.basename(absoluteSlidesPath);

    if (action === 'dev') {
        command = {
            file: 'node',
            args: [slidevPath, slidesArg, '--open'],
        };
    } else {
        command = {
            file: 'node',
            args: [
                slidevPath,
                'export',
                '--timeout',
                '60000',
                '--wait-until',
                'domcontentloaded',
                slidesArg,
            ],
        };
    }

    return new Promise<number>((resolve) => {
        const child = spawn(command.file, command.args, {
            cwd,
            stdio: 'inherit',
            env: { ...process.env, NODE_ENV: 'development' },
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
