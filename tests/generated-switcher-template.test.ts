import { describe, expect, it } from 'vitest';
import {
    renderNavControlComponent,
    type DeckEntry,
    type SwitcherTemplateOptions,
} from '../src/bridge/generated-switcher-template.js';

const DECKS: DeckEntry[] = [
    {
        folder: 'intro',
        label: 'Intro (presentations/intro/slides.md)',
        slug: 'intro',
        title: 'Intro',
        detail: 'presentations/intro/slides.md',
    },
    {
        folder: 'advanced',
        label: 'Advanced (presentations/advanced/slides.md)',
        slug: 'advanced',
        title: 'Advanced',
        detail: 'presentations/advanced/slides.md',
    },
    {
        folder: 'deep-dive',
        label: 'Deep Dive (presentations/deep-dive/slides.md)',
        slug: 'deep-dive',
        title: 'Deep Dive',
        detail: 'presentations/deep-dive/slides.md',
    },
];

function makeOptions(overrides: Partial<SwitcherTemplateOptions> = {}): SwitcherTemplateOptions {
    return {
        decks: DECKS,
        currentSlug: 'intro',
        bridgeUrl: 'http://localhost:3000/__bridge',
        ...overrides,
    };
}

describe('renderNavControlComponent', () => {
    it('returns a valid Vue SFC with template and scoped style blocks', () => {
        const output = renderNavControlComponent(makeOptions());

        expect(output).toContain('<template>');
        expect(output).toContain('</template>');
        expect(output).toContain('<style scoped>');
        expect(output).toContain('</style>');
    });

    it('renders a submit button for each deck inside the dropdown menu', () => {
        const output = renderNavControlComponent(makeOptions());

        expect(output).toContain('formaction="http://localhost:3000/__bridge/switch?folder=intro"');
        expect(output).toContain(
            'formaction="http://localhost:3000/__bridge/switch?folder=advanced"',
        );
        expect(output).toContain(
            'formaction="http://localhost:3000/__bridge/switch?folder=deep-dive"',
        );
        expect(output).toContain('class="smgr-item-title">Intro<');
        expect(output).toContain('class="smgr-item-title">Advanced<');
        expect(output).toContain('class="smgr-item-title">Deep Dive<');
        expect(output).toContain('class="smgr-item-detail">presentations/intro/slides.md<');
    });

    it('marks the current deck button as active and disabled', () => {
        const output = renderNavControlComponent(makeOptions({ currentSlug: 'advanced' }));

        const advancedBtnMatch = output.match(/<button[^>]*formaction="[^"]*advanced"[^>]*>/);
        expect(advancedBtnMatch).not.toBeNull();
        const advancedBtn = advancedBtnMatch?.[0] ?? '';
        expect(advancedBtn).toContain('smgr-item--active');
        expect(advancedBtn).toContain('disabled');

        const introBtnMatch = output.match(/<button[^>]*formaction="[^"]*intro"[^>]*>/);
        expect(introBtnMatch).not.toBeNull();
        const introBtn = introBtnMatch?.[0] ?? '';
        expect(introBtn).not.toContain('smgr-item--active');
        expect(introBtn).not.toContain('disabled');
    });

    it('uses a form with POST method for bridge submission', () => {
        const output = renderNavControlComponent(makeOptions());

        expect(output).toContain('method="POST"');
        expect(output).toContain('target="slidev-manager-switch-target"');
        expect(output).toContain('name="slidev-manager-switch-target"');
    });

    it('includes a compact icon trigger', () => {
        const output = renderNavControlComponent(makeOptions());

        expect(output).toContain('class="smgr-trigger"');
        expect(output).not.toContain('smgr-trigger-badge');
        expect(output).toContain('<svg');
        expect(output).toContain('width="18"');
        expect(output).toContain('height="18"');
        expect(output).toContain('title="Switch deck"');
    });

    it('uses native details/summary for robust toggle behavior', () => {
        const output = renderNavControlComponent(makeOptions());

        expect(output).toContain('<details class="smgr-details">');
        expect(output).toContain('<summary class="smgr-trigger"');
        expect(output).toContain('.smgr-details[open] .smgr-menu-shell');
    });

    it('uses the simpler 40px round trigger and compact menu shell', () => {
        const output = renderNavControlComponent(makeOptions());

        expect(output).toContain('width: 40px;');
        expect(output).toContain('height: 40px;');
        expect(output).toContain('padding: 0.5rem;');
        expect(output).toContain('border-radius: 999px;');
        expect(output).toContain('padding: 0.65rem;');
        expect(output).toContain('font-size: 12px;');
        expect(output).toContain('--smgr-surface: #ffffff;');
        expect(output).toContain('--smgr-surface: #000000;');
        expect(output).not.toContain('class="smgr-menu-header"');
    });

    it('escapes HTML entities in deck labels', () => {
        const decks: DeckEntry[] = [
            {
                folder: 'xss',
                label: '<script>alert("xss")</script>',
                slug: 'xss',
                title: '<script>alert("xss")</script>',
                detail: 'presentations/xss/slides.md',
            },
            {
                folder: 'other',
                label: 'Other',
                slug: 'other',
                title: 'Other',
                detail: 'presentations/other/slides.md',
            },
        ];
        const output = renderNavControlComponent(makeOptions({ decks, currentSlug: 'xss' }));

        expect(output).not.toContain('<script>alert');
        expect(output).toContain('&lt;script&gt;');
    });

    it('escapes special characters in folder names used in formaction', () => {
        const decks: DeckEntry[] = [
            {
                folder: 'a"b<c',
                label: 'Quoted',
                slug: 'quoted',
                title: 'Quoted',
                detail: 'presentations/quoted/slides.md',
            },
            {
                folder: 'safe',
                label: 'Safe',
                slug: 'safe',
                title: 'Safe',
                detail: 'presentations/safe/slides.md',
            },
        ];
        const output = renderNavControlComponent(makeOptions({ decks }));

        expect(output).toContain('a%22b%3Cc');
        expect(output).not.toContain('a"b<c');
    });

    it('returns an empty template when there is only one deck', () => {
        const output = renderNavControlComponent(makeOptions({ decks: [DECKS[0]!] }));

        expect(output.trim()).toBe('<template />');
    });

    it('is deterministic for the same input', () => {
        const options = makeOptions({ currentSlug: 'advanced' });

        const first = renderNavControlComponent(options);
        const second = renderNavControlComponent(options);

        expect(second).toBe(first);
    });
});
