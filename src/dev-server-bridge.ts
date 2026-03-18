import type { ChildProcess } from 'node:child_process';
import { spawn } from 'node:child_process';
import http from 'node:http';
import { createRequire } from 'node:module';
import path from 'node:path';
import { cleanDevSwitcherFiles, generateDevSwitcherFiles } from './dev-switcher.js';
import type { DeckEntry } from './generated-switcher-template.js';
import {
    formatPresentationLabel,
    type PresentationLabelInput,
    toSlug,
} from './presentation-helpers.js';
import type { PresentationOption } from './presentation-selector.js';

export interface LaunchContext {
    selected: PresentationOption;
    presentations: PresentationOption[];
    args: string[];
}

export interface DevServerBridge {
    readonly bridgePort: number;
    readonly currentFolder: string;
    stop(): Promise<void>;
}

export function createLaunchContext(
    selected: PresentationOption,
    presentations: PresentationOption[],
    args: string[],
): LaunchContext {
    return { selected, presentations, args };
}

export async function startDevServerBridge(context: LaunchContext): Promise<DevServerBridge> {
    let slidevProcess: ChildProcess | null = null;
    let currentSelection = context.selected;
    let preparedDeckRoot: string | null = null;

    const require = createRequire(import.meta.url);
    const slidevPath = require.resolve('@slidev/cli/bin/slidev.mjs');
    const deckEntries = toDeckEntries(context.presentations);

    async function launchSlidev(): Promise<void> {
        const absoluteSlidesPath = currentSelection.slidesPath;
        if (!absoluteSlidesPath) {
            throw new Error(`Could not determine slides path for "${currentSelection.folder}"`);
        }

        const cwd = path.dirname(absoluteSlidesPath);
        preparedDeckRoot = cwd;
        await generateDevSwitcherFiles({
            deckRoot: cwd,
            decks: deckEntries,
            currentSlug: toSlug(currentSelection.folder, currentSelection.workspace),
            bridgeUrl: `http://127.0.0.1:${resolvedPort}/__bridge/switch`,
        });
        const slidesArg = path.basename(absoluteSlidesPath);
        const commandArgs = [slidevPath, slidesArg, ...context.args];

        console.log(`[bridge] Launching Slidev dev for "${currentSelection.folder}"...`);

        slidevProcess = spawn('node', commandArgs, {
            cwd,
            stdio: 'inherit',
            env: {
                ...process.env,
                NODE_ENV: 'development',
            },
        });

        slidevProcess.on('error', (error) => {
            console.error(`[bridge] Failed to start Slidev dev:`, error.message);
        });

        slidevProcess.on('exit', (code, signal) => {
            if (signal !== 'SIGTERM') {
                console.log(`[bridge] Slidev dev exited with code ${code ?? 0}`);
            }
            slidevProcess = null;
        });
    }

    function killSlidev(): Promise<void> {
        return new Promise((resolve) => {
            if (!slidevProcess) {
                resolve();
                return;
            }

            const child = slidevProcess;
            slidevProcess = null;

            child.on('exit', () => {
                resolve();
            });

            child.kill('SIGTERM');
        });
    }

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', `http://localhost`);
        const targetUrl = resolveSlidevUrl(req, context.args);

        if (url.pathname === '/__bridge/presentations' && req.method === 'GET') {
            const body = JSON.stringify({
                current: currentSelection.folder,
                presentations: deckEntries,
            });
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(body);
            return;
        }

        if (url.pathname === '/__bridge/switch' && req.method === 'POST') {
            const folder = url.searchParams.get('folder');
            if (!folder) {
                res.writeHead(400, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Missing "folder" query parameter' }));
                return;
            }

            const target = context.presentations.find((p) => p.folder === folder);
            if (!target) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: `Presentation "${folder}" not found` }));
                return;
            }

            if (target.folder === currentSelection.folder) {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(renderRedirectPage(targetUrl, `"${folder}" is already running.`));
                return;
            }

            console.log(`[bridge] Switching from "${currentSelection.folder}" to "${folder}"...`);

            await killSlidev();
            if (preparedDeckRoot) {
                await cleanDevSwitcherFiles(preparedDeckRoot);
                preparedDeckRoot = null;
            }
            currentSelection = target;
            await launchSlidev();

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(renderRedirectPage(targetUrl, `Switching to "${folder}"...`));
            return;
        }

        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Not found' }));
    });

    let resolvedPort = 0;

    await new Promise<void>((resolve, reject) => {
        server.listen(0, '127.0.0.1', () => {
            const addr = server.address();
            if (addr && typeof addr === 'object') {
                resolvedPort = addr.port;
            }
            resolve();
        });
        server.on('error', reject);
    });

    await launchSlidev();

    console.log(`[bridge] Bridge server listening on http://127.0.0.1:${resolvedPort}`);

    return {
        get bridgePort() {
            return resolvedPort;
        },
        get currentFolder() {
            return currentSelection.folder;
        },
        async stop() {
            await killSlidev();
            if (preparedDeckRoot) {
                await cleanDevSwitcherFiles(preparedDeckRoot);
                preparedDeckRoot = null;
            }
            await new Promise<void>((resolve) => {
                server.close(() => {
                    resolve();
                });
            });
        },
    };
}

function toDeckEntries(presentations: PresentationOption[]): DeckEntry[] {
    return presentations
        .filter((presentation) => Boolean(presentation.slidesPath))
        .map((presentation) => {
            const labelInput: PresentationLabelInput = {
                folder: presentation.folder,
                workspace: presentation.workspace,
                title: presentation.title,
                run:
                    presentation.run.type === 'workspace'
                        ? {
                              type: 'workspace',
                              workspace: presentation.run.workspace,
                              action: presentation.run.action,
                          }
                        : {
                              type: 'slides',
                              relativeSlidesPath:
                                  presentation.run.relativeSlidesPath ??
                                  presentation.relativeSlidesPath ??
                                  undefined,
                              action: presentation.run.action,
                          },
            };

            return {
                folder: presentation.folder,
                label: formatPresentationLabel(labelInput),
                slug: toSlug(presentation.folder, presentation.workspace),
                title: presentation.title ?? presentation.folder,
                detail:
                    presentation.run.type === 'workspace'
                        ? (presentation.workspace ?? presentation.folder)
                        : (presentation.run.relativeSlidesPath ??
                          presentation.relativeSlidesPath ??
                          presentation.folder),
            };
        });
}

function resolveSlidevUrl(req: http.IncomingMessage, args: string[]): string {
    const referer = req.headers.referer;

    if (referer) {
        try {
            const refererUrl = new URL(referer);
            return new URL(resolveBasePath(args), refererUrl.origin).toString();
        } catch {
            return `http://127.0.0.1:${resolvePort(args)}${resolveBasePath(args)}`;
        }
    }

    return `http://127.0.0.1:${resolvePort(args)}${resolveBasePath(args)}`;
}

function resolvePort(args: string[]): string {
    for (let index = 0; index < args.length; index += 1) {
        const arg = args[index];

        if (!arg) {
            continue;
        }

        if (arg === '--port' || arg === '-p') {
            return args[index + 1] ?? '3030';
        }

        if (arg.startsWith('--port=')) {
            return arg.slice('--port='.length) || '3030';
        }

        if (arg.startsWith('-p') && arg.length > 2) {
            return arg.slice(2) || '3030';
        }
    }

    return '3030';
}

function resolveBasePath(args: string[]): string {
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

function normalizeBasePath(basePath: string): string {
    if (!basePath.startsWith('/')) {
        return `/${basePath}`;
    }

    return basePath;
}

function renderRedirectPage(targetUrl: string, message: string): string {
    const escapedMessage = escapeHtml(message);
    const escapedTargetUrl = JSON.stringify(targetUrl);
    const statusUrl = JSON.stringify(new URL(targetUrl).toString());

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Switching Slidev deck</title>
  </head>
  <body>
    <p>${escapedMessage}</p>
    <p><a href="${escapeHtml(targetUrl)}">Return to Slidev</a></p>
    <script>
      const targetUrl = ${escapedTargetUrl};
      const probeUrl = ${statusUrl};

      const navigate = () => {
        if (window.top && window.top !== window) {
          window.top.location.replace(targetUrl);
          return;
        }

        window.location.replace(targetUrl);
      };

      const waitForServer = async () => {
        const deadline = Date.now() + 20000;

        while (Date.now() < deadline) {
          try {
            const response = await fetch(probeUrl, {
              method: 'HEAD',
              cache: 'no-store',
              mode: 'no-cors',
            });

            if (response.type === 'opaque' || response.ok) {
              navigate();
              return;
            }
          } catch {
            // Slidev dev server is still restarting.
          }

          await new Promise((resolve) => window.setTimeout(resolve, 250));
        }

        navigate();
      };

      void waitForServer();
    </script>
  </body>
</html>`;
}

function escapeHtml(value: string): string {
    return value
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}
