import type { ChildProcess } from 'node:child_process';
import http from 'node:http';
import type { Duplex } from 'node:stream';
import path from 'node:path';
import { cleanDevSwitcherFiles, generateDevSwitcherFiles } from './dev-switcher.js';
import type { DeckEntry } from './generated-switcher-template.js';
import {
    formatPresentationLabel,
    type PresentationLabelInput,
    toSlug,
} from '../presentation/presentation-helpers.js';
import {
    createDevSpawnSpec,
    openBrowser,
    reservePort,
    resolveBasePath,
    resolvePort,
    shouldOpenBrowser,
    spawnWithSpec,
    waitForHttpReady,
} from '../presentation/presentation-runner.js';
import type { PresentationOption } from '../selector/presentation-selector.js';
import { getErrorMessage } from '../utils/process-utils.js';

const PUBLIC_HOST = 'localhost';
const LOG_PREFIX = '[slidev-manager]';
const ANSI_CYAN = '\u001B[36m';
const ANSI_RESET = '\u001B[0m';

export interface LaunchContext {
    selected: PresentationOption;
    presentations: PresentationOption[];
    projectRoot: string;
    args: string[];
    devArgs?: string[];
}

export interface DevServerBridge {
    readonly bridgePort: number;
    readonly currentFolder: string;
    switchDeck(folder: string): Promise<SwitchDeckResult>;
    stop(): Promise<void>;
    waitUntilStopped(): Promise<number>;
}

export interface SwitchDeckResult {
    success: boolean;
    folder: string;
    alreadyRunning?: boolean;
    error?: string;
}

export interface DevServerBridgeRuntime {
    reservePort?: () => Promise<number>;
    waitForReady?: (url: string) => Promise<void>;
    openBrowser?: (url: string) => Promise<void>;
}

interface DevSession {
    selection: PresentationOption;
    process: ChildProcess;
    upstreamPort: number;
    preparedDeckRoot: string | null;
}

export function createLaunchContext(
    selected: PresentationOption,
    presentations: PresentationOption[],
    projectRoot: string,
    args: string[],
    devArgs: string[] = args,
): LaunchContext {
    return { selected, presentations, projectRoot, args, devArgs };
}

export async function startDevServerBridge(
    context: LaunchContext,
    runtime: DevServerBridgeRuntime = {},
): Promise<DevServerBridge> {
    const deckEntries = toDeckEntries(context.presentations);
    const basePath = resolveBasePath(context.args);
    const shouldOpen = shouldOpenBrowser(context.args);
    const reservePortImpl = runtime.reservePort ?? reservePort;
    const waitForReadyImpl = runtime.waitForReady ?? waitForHttpReady;
    const openBrowserImpl = runtime.openBrowser ?? openBrowser;

    let publicPort = resolvePort(context.args);
    let currentSelection = context.selected;
    let currentSession: DevSession | null = null;
    let stopPromise: Promise<void> | null = null;
    let stopped = false;
    let stopExitCode = 0;
    let resolveStopped: ((code: number) => void) | null = null;
    const stoppedPromise = new Promise<number>((resolve) => {
        resolveStopped = resolve;
    });

    const server = http.createServer(async (req, res) => {
        const url = new URL(req.url ?? '/', publicUrl(publicPort, '/'));

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

            const targetUrl = publicUrl(publicPort, basePath);
            const result = await bridgeSwitchDeck(folder);

            if (!result.success && result.error?.includes('not found')) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: result.error }));
                return;
            }

            if (result.success && result.alreadyRunning) {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(renderRedirectPage(targetUrl, `"${folder}" is already running.`));
                return;
            }

            if (result.success) {
                res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                res.end(renderRedirectPage(targetUrl, `Switched to "${folder}".`));
                return;
            }

            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: result.error }));
            return;
        }

        await proxyHttpRequest(req, res, currentSession?.upstreamPort ?? null);
    });

    server.on('upgrade', (req, socket, head) => {
        socket.on('error', () => {
            // Browser HMR sockets can reset while decks switch.
        });
        void proxyWebSocketUpgrade(req, socket, head, currentSession?.upstreamPort ?? null);
    });

    server.on('clientError', (_error, socket) => {
        socket.destroy();
    });

    await new Promise<void>((resolve, reject) => {
        server.listen(publicPort, () => {
            const address = server.address();
            if (address && typeof address === 'object') {
                publicPort = address.port;
            }
            resolve();
        });

        server.on('error', reject);
    });

    currentSession = await createSession(currentSelection);

    console.log(formatManagerLog(`Ready at ${formatUrlForLog(publicUrl(publicPort, basePath))}`));

    if (shouldOpen) {
        try {
            await openBrowserImpl(publicUrl(publicPort, basePath));
        } catch (error: unknown) {
            console.warn(`${LOG_PREFIX} Failed to open browser: ${getErrorMessage(error)}`);
        }
    }

    async function bridgeSwitchDeck(folder: string): Promise<SwitchDeckResult> {
        const target = context.presentations.find(
            (presentation) => presentation.folder === folder,
        );
        if (!target) {
            return { success: false, folder, error: `Presentation "${folder}" not found` };
        }
        if (target.folder === currentSelection.folder) {
            return { success: true, folder, alreadyRunning: true };
        }

        console.log(
            formatManagerLog(`Switching from "${currentSelection.folder}" to "${folder}"...`),
        );

        try {
            const nextSession = await createSession(target);
            const previousSession = currentSession;
            currentSession = nextSession;
            currentSelection = target;

            if (previousSession) {
                await stopSession(previousSession);
            }

            return { success: true, folder };
        } catch (error: unknown) {
            return { success: false, folder, error: getErrorMessage(error) };
        }
    }

    return {
        get bridgePort() {
            return publicPort;
        },
        get currentFolder() {
            return currentSelection.folder;
        },
        switchDeck(folder: string) {
            return bridgeSwitchDeck(folder);
        },
        async stop() {
            await stopBridge();
        },
        waitUntilStopped() {
            return stoppedPromise;
        },
    };

    async function createSession(selection: PresentationOption): Promise<DevSession> {
        const upstreamPort = await reservePortImpl();
        const preparedDeckRoot = resolveDeckRoot(selection);

        try {
            if (preparedDeckRoot) {
                await generateDevSwitcherFiles({
                    deckRoot: preparedDeckRoot,
                    decks: deckEntries,
                    currentSlug: toSlug(selection.folder, selection.workspace),
                    bridgeUrl: publicUrl(publicPort, '/__bridge/switch'),
                });
            }

            const spec = await createDevSpawnSpec(
                selection,
                context.devArgs ?? context.args,
                upstreamPort,
            );

            console.log(formatManagerLog(`Launching Slidev dev for "${selection.folder}"...`));

            const process = spawnWithSpec(spec);
            process.on('error', (error) => {
                console.error(`${LOG_PREFIX} Failed to start dev process:`, error.message);
            });
            process.on('exit', (code, signal) => {
                if (currentSession?.process !== process) {
                    console.log(
                        formatManagerLog(
                            `Stopped previous Slidev dev for "${selection.folder}" after switching decks.`,
                        ),
                    );
                } else if (signal === 'SIGTERM') {
                    console.log(
                        formatManagerLog(
                            `Stopped Slidev dev for "${selection.folder}" while closing the manager.`,
                        ),
                    );
                } else {
                    console.log(`${LOG_PREFIX} Slidev dev exited with code ${code ?? 0}`);
                }

                if (currentSession?.process === process) {
                    void stopBridge(code ?? 0);
                }
            });

            await waitForReadyImpl(publicUrl(upstreamPort, basePath));

            return {
                selection,
                process,
                upstreamPort,
                preparedDeckRoot,
            };
        } catch (error: unknown) {
            if (preparedDeckRoot) {
                await cleanDevSwitcherFiles(preparedDeckRoot);
            }

            throw error;
        }
    }

    async function stopBridge(exitCode: number = 0): Promise<void> {
        if (stopPromise) {
            return stopPromise;
        }

        stopPromise = (async () => {
            const session = currentSession;
            currentSession = null;

            if (session) {
                await stopSession(session);
            }

            await new Promise<void>((resolve) => {
                server.close(() => {
                    resolve();
                });
            });

            if (!stopped) {
                stopped = true;
                stopExitCode = exitCode;
                resolveStopped?.(stopExitCode);
            }
        })();

        return stopPromise;
    }
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

async function stopSession(session: DevSession): Promise<void> {
    await killChildProcess(session.process);

    if (session.preparedDeckRoot) {
        await cleanDevSwitcherFiles(session.preparedDeckRoot);
    }
}

function killChildProcess(child: ChildProcess): Promise<void> {
    return new Promise((resolve) => {
        let settled = false;

        const finish = () => {
            if (settled) {
                return;
            }
            settled = true;
            resolve();
        };

        child.once('exit', finish);
        child.once('error', finish);

        if (child.exitCode !== null || child.killed) {
            finish();
            return;
        }

        child.kill('SIGTERM');
    });
}

async function proxyHttpRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    upstreamPort: number | null,
): Promise<void> {
    if (!upstreamPort) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'No active Slidev dev server' }));
        return;
    }

    const body = await readRequestBody(req);

    await proxyHttpRequestWithHosts(req, res, upstreamPort, body, ['127.0.0.1', 'localhost']);
}

async function proxyWebSocketUpgrade(
    req: http.IncomingMessage,
    socket: Duplex,
    head: Buffer,
    upstreamPort: number | null,
): Promise<void> {
    if (!upstreamPort) {
        socket.destroy();
        return;
    }

    await proxyWebSocketUpgradeWithHosts(req, socket, head, upstreamPort, [
        '127.0.0.1',
        'localhost',
    ]);
}

async function readRequestBody(req: http.IncomingMessage): Promise<Buffer> {
    const chunks: Buffer[] = [];

    for await (const chunk of req) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }

    return Buffer.concat(chunks);
}

async function proxyHttpRequestWithHosts(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    upstreamPort: number,
    body: Buffer,
    hosts: string[],
): Promise<void> {
    const [host, ...restHosts] = hosts;

    await new Promise<void>((resolve) => {
        const proxyReq = http.request(
            {
                hostname: host,
                port: upstreamPort,
                method: req.method,
                path: req.url,
                headers: req.headers,
            },
            (proxyRes) => {
                res.writeHead(proxyRes.statusCode ?? 502, proxyRes.headers);
                proxyRes.pipe(res);
                proxyRes.on('end', resolve);
            },
        );

        proxyReq.on('error', async (error) => {
            if (restHosts.length > 0) {
                resolve(await proxyHttpRequestWithHosts(req, res, upstreamPort, body, restHosts));
                return;
            }

            if (!res.headersSent) {
                res.writeHead(502, { 'Content-Type': 'application/json' });
            }
            res.end(JSON.stringify({ error: getErrorMessage(error) }));
            resolve();
        });

        if (body.length > 0) {
            proxyReq.write(body);
        }

        proxyReq.end();
    });
}

async function proxyWebSocketUpgradeWithHosts(
    req: http.IncomingMessage,
    socket: Duplex,
    head: Buffer,
    upstreamPort: number,
    hosts: string[],
): Promise<void> {
    const [host, ...restHosts] = hosts;

    await new Promise<void>((resolve) => {
        const proxyReq = http.request({
            hostname: host,
            port: upstreamPort,
            method: req.method,
            path: req.url,
            headers: req.headers,
        });

        consumeSocketErrors(socket);

        proxyReq.on('upgrade', (proxyRes, proxySocket, proxyHead) => {
            consumeSocketErrors(proxySocket);

            socket.write(serializeUpgradeResponse(proxyRes));

            if (proxyHead.length > 0) {
                socket.write(proxyHead);
            }

            if (head.length > 0) {
                proxySocket.write(head);
            }

            socket.on('close', () => {
                safeDestroy(proxySocket);
            });
            proxySocket.on('close', () => {
                safeDestroy(socket);
            });
            proxySocket.pipe(socket);
            socket.pipe(proxySocket);
            resolve();
        });

        proxyReq.on('response', (proxyRes) => {
            proxyRes.resume();
            safeDestroy(socket);
            resolve();
        });

        proxyReq.on('error', async () => {
            if (restHosts.length > 0) {
                resolve(
                    await proxyWebSocketUpgradeWithHosts(
                        req,
                        socket,
                        head,
                        upstreamPort,
                        restHosts,
                    ),
                );
                return;
            }

            socket.destroy();
            resolve();
        });

        proxyReq.end();
    });
}

function consumeSocketErrors(socket: Duplex): void {
    socket.on('error', () => {
        // Socket resets are expected when the browser reconnects during deck switches.
    });
}

function safeDestroy(socket: Duplex): void {
    if (socket.destroyed) {
        return;
    }

    socket.destroy();
}

function serializeUpgradeResponse(response: http.IncomingMessage): string {
    const statusLine = `HTTP/1.1 ${response.statusCode ?? 101} ${response.statusMessage ?? 'Switching Protocols'}\r\n`;
    const headers = Object.entries(response.headers)
        .flatMap(([name, value]) => {
            if (value === undefined) {
                return [];
            }

            if (Array.isArray(value)) {
                return value.map((item) => `${name}: ${item}\r\n`);
            }

            return `${name}: ${value}\r\n`;
        })
        .join('');

    return `${statusLine}${headers}\r\n`;
}

function resolveDeckRoot(selection: PresentationOption): string | null {
    const slidesPath = selection.run.slidesPath ?? selection.slidesPath;
    return slidesPath ? path.dirname(slidesPath) : null;
}

function publicUrl(port: number, pathname: string): string {
    return new URL(pathname, `http://${PUBLIC_HOST}:${port}`).toString();
}

function formatUrlForLog(url: string): string {
    return `${ANSI_CYAN}${url}${ANSI_RESET}`;
}

function formatManagerLog(message: string): string {
    return `\n${LOG_PREFIX} ${message}\n`;
}

function renderRedirectPage(targetUrl: string, message: string): string {
    const escapedMessage = escapeHtml(message);
    const escapedTargetUrl = JSON.stringify(targetUrl);

    return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Switching Slidev deck</title>
  </head>
  <body>
    <p>${escapedMessage}</p>
    <p><a href="${escapeHtml(targetUrl)}">Open Slidev</a></p>
    <script>
      const targetUrl = ${escapedTargetUrl};

      if (window.top && window.top !== window) {
        window.top.location.replace(targetUrl);
      } else {
        window.location.replace(targetUrl);
      }
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
