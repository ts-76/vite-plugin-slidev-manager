import { afterEach, describe, expect, it, vi } from 'vitest';
import { resolveInvocation } from '../src/invocation/index.js';

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

describe('resolveInvocation', () => {
    it('uses the default dev command and args when no passthrough args are provided', () => {
        expect(resolveInvocation('dev', {}, ['node', 'vite'])).toEqual({
            action: 'dev',
            args: ['--open'],
            browserExport: false,
        });
    });

    it('allows switching dev flow to browser export via forwarded CLI arguments', () => {
        expect(
            resolveInvocation('dev', {}, ['node', 'vite', '--', '--export', '--output', 'deck']),
        ).toEqual({
            action: 'export',
            args: ['--timeout', '60000', '--wait-until', 'domcontentloaded', '--output', 'deck'],
            browserExport: true,
        });
    });

    it('lets user-provided args override built-in defaults by appearing later', () => {
        expect(
            resolveInvocation('export', { exportArgs: ['--output', 'default.pdf'] }, [
                'node',
                'vite',
                'build',
                '--',
                '--output',
                'custom.pdf',
            ]),
        ).toEqual({
            action: 'export',
            args: [
                '--output',
                'default.pdf',
                '--timeout',
                '60000',
                '--wait-until',
                'domcontentloaded',
                '--output',
                'custom.pdf',
            ],
            browserExport: false,
        });
    });

    it('treats forwarded --export as browser-export mode while keeping export args intact', () => {
        expect(
            resolveInvocation('dev', {}, [
                'node',
                'vite',
                '--',
                '--export',
                '--open=false',
                '--port',
                '4040',
            ]),
        ).toEqual({
            action: 'export',
            args: [
                '--timeout',
                '60000',
                '--wait-until',
                'domcontentloaded',
                '--open=false',
                '--port',
                '4040',
            ],
            browserExport: true,
        });
    });

    it('uses configured build args for build invocations', () => {
        expect(
            resolveInvocation('build', { buildArgs: ['--out', 'dist/slides'] }, [
                'node',
                'vite',
                'build',
            ]),
        ).toEqual({
            action: 'build',
            args: ['--out', 'dist/slides'],
            browserExport: false,
        });
    });

    it('ignores direct nonstandard vite export invocations', () => {
        expect(resolveInvocation('dev', {}, ['node', 'vite', 'export', '--port', '4040'])).toEqual({
            action: 'dev',
            args: ['--open'],
            browserExport: false,
        });
    });
});
