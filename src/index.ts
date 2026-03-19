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
    let viteRoot = process.cwd();

    return {
        name: 'presentation-manager',
        configResolved(config) {
            viteRoot = config.root;
        },
        async configureServer(_server: ViteDevServer) {
            await runDevSelector(resolveInvocation('dev', options), options, viteRoot);
        },
        async buildStart() {
            if (!process.argv.includes('build')) {
                return;
            }

            const exitCode = await runBuildSelector(
                resolveInvocation(options.defaultBuildCommand ?? 'build', options),
                options,
                viteRoot,
            );
            process.exit(exitCode);
        },
    };
}
