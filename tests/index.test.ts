import { describe, expect, it } from 'vitest';
import { resolveInvocation } from '../src/index.js';

describe('resolveInvocation', () => {
    it('uses the default dev command and args when no passthrough args are provided', () => {
        expect(resolveInvocation('dev', {}, ['node', 'vite'])).toEqual({
            action: 'dev',
            args: ['--open'],
        });
    });

    it('allows switching build flow to export via forwarded CLI arguments', () => {
        expect(
            resolveInvocation('build', {}, [
                'node',
                'vite',
                'build',
                '--',
                'export',
                '--output',
                'deck',
            ]),
        ).toEqual({
            action: 'export',
            args: ['--timeout', '60000', '--wait-until', 'domcontentloaded', '--output', 'deck'],
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
        });
    });
});