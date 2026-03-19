import type { Plugin, ViteDevServer } from 'vite';
import type { PresentationAction } from './selector/presentation-selector.js';
import { resolveInvocation } from './invocation/index.js';
import { runBuildSelector, runDevSelector } from './selector/flow.js';

export interface PresentationManagerOptions {
    presentationsDir?: string;
    devArgs?: string[];
    buildArgs?: string[];
    exportArgs?: string[];
    defaultBuildCommand?: Extract<PresentationAction, 'build' | 'export'>;
}

export { resolveInvocation } from './invocation/index.js';

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

            const exitCode = await runBuildSelector(
                resolveInvocation(options.defaultBuildCommand ?? 'build', options),
                options,
            );
            process.exit(exitCode);
        },
    };
}
