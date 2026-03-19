import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolvePresentationsDir } from '../src/selector/flow.js';

describe('resolvePresentationsDir', () => {
    it('resolves relative directories from the Vite root', () => {
        expect(
            resolvePresentationsDir({ presentationsDir: 'slides/presentations' }, '/repo/app'),
        ).toBe(path.resolve('/repo/app', 'slides/presentations'));
    });

    it('keeps absolute directories intact', () => {
        expect(resolvePresentationsDir({ presentationsDir: '/external/decks' }, '/repo/app')).toBe(
            path.resolve('/external/decks'),
        );
    });

    it('returns undefined when no presentations directory is configured', () => {
        expect(resolvePresentationsDir({}, '/repo/app')).toBeUndefined();
    });
});
