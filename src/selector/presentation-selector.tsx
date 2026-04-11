import { Box, render, Text, useInput } from 'ink';
import type { Instance } from 'ink';
import React, { useEffect, useMemo, useState } from 'react';
import {
    loadPresentationMetadata,
    type PresentationAction,
    type PresentationMetadata,
} from '../presentation/metadata-loader.js';
import {
    createPresentationKey,
    formatPresentationListItem,
    matchPresentationSearch,
} from '../presentation/presentation-helpers.js';

export { loadPresentationMetadata };
export type { PresentationAction };

export interface SelectPresentationOptions {
    action: PresentationAction;
    heading: string;
    helpText: string;
    projectRoot?: string;
    presentationsDir?: string;
    preselectedFolder?: string;
}

export interface SelectPresentationResult {
    options: PresentationOption[];
    selected: PresentationOption | null;
    cancelled: boolean;
    reason?: 'preselected' | 'single-option' | 'interactive' | 'non-interactive-without-selection';
}

export interface PresentationOption {
    folder: string;
    presentationDir: string;
    workspace: string | null;
    title: string | null;
    date: string | null;
    author: string | null;
    run: {
        type: 'workspace' | 'slides';
        workspace?: string;
        slidesPath?: string;
        relativeSlidesPath?: string;
        action: PresentationAction;
    };
    slidesPath: string | null;
    relativeSlidesPath: string | null;
}

export async function selectPresentation({
    action,
    heading,
    helpText,
    projectRoot,
    presentationsDir,
    preselectedFolder,
}: SelectPresentationOptions): Promise<SelectPresentationResult> {
    const metadata = await loadPresentationMetadata(projectRoot, presentationsDir);
    const options = metadata
        .map((meta) => createOptionFromMetadata(meta, action))
        .filter((opt): opt is PresentationOption => opt !== null);

    if (options.length === 0) {
        return { options, selected: null, cancelled: false };
    }

    if (preselectedFolder) {
        const selected = resolvePreselectedOption(options, preselectedFolder);
        return { options, selected, cancelled: false, reason: 'preselected' };
    }

    if (options.length === 1) {
        return { options, selected: options[0] ?? null, cancelled: false, reason: 'single-option' };
    }

    if (!process.stdin.isTTY || !process.stdout.isTTY) {
        return {
            options,
            selected: null,
            cancelled: false,
            reason: 'non-interactive-without-selection',
        };
    }

    let selected: PresentationOption | null = null;
    let cancelled = false;
    let app: Instance | undefined;

    const handleSelect = (option: PresentationOption) => {
        selected = option;
        app?.unmount();
    };

    const handleCancel = () => {
        cancelled = true;
        app?.unmount();
    };

    app = render(
        React.createElement(Selector, {
            options,
            heading,
            helpText,
            action,
            onSelect: handleSelect,
            onCancel: handleCancel,
        }),
    );

    await app.waitUntilExit();

    return { options, selected, cancelled, reason: 'interactive' };
}

interface SelectorProps {
    options: PresentationOption[];
    heading: string;
    helpText: string;
    action: PresentationAction;
    onSelect: (option: PresentationOption) => void;
    onCancel: () => void;
}

function Selector({ options, heading, helpText, action, onSelect, onCancel }: SelectorProps) {
    void action;
    const [query, setQuery] = useState<string>('');
    const [selectedIndex, setSelectedIndex] = useState<number>(0);

    const filteredOptions = useMemo(() => filterOptions(options, query), [options, query]);

    useEffect(() => {
        setSelectedIndex((currentIndex: number) => {
            if (filteredOptions.length === 0) {
                return 0;
            }

            return Math.min(currentIndex, filteredOptions.length - 1);
        });
    }, [filteredOptions]);

    useInput((input: string, key: { return?: boolean; upArrow?: boolean; downArrow?: boolean; backspace?: boolean; delete?: boolean; escape?: boolean; ctrl?: boolean; meta?: boolean }) => {
        if (key.return) {
            const selected = filteredOptions[selectedIndex];
            if (selected) {
                onSelect(selected);
            }
            return;
        }

        if (key.upArrow) {
            setSelectedIndex((currentIndex: number) =>
                filteredOptions.length === 0
                    ? 0
                    : (currentIndex - 1 + filteredOptions.length) % filteredOptions.length,
            );
            return;
        }

        if (key.downArrow) {
            setSelectedIndex((currentIndex: number) =>
                filteredOptions.length === 0 ? 0 : (currentIndex + 1) % filteredOptions.length,
            );
            return;
        }

        if (key.backspace || key.delete) {
            setQuery((currentQuery: string) => currentQuery.slice(0, -1));
            return;
        }

        if (input === 'q' || key.escape) {
            if (query.length > 0) {
                setQuery('');
                setSelectedIndex(0);
                return;
            }

            onCancel();
            return;
        }

        if (key.ctrl || key.meta || !input || /[\u0000-\u001f]/.test(input)) {
            return;
        }

        setQuery((currentQuery: string) => currentQuery + input);
        setSelectedIndex(0);
    });

    return React.createElement(
        Box,
        { flexDirection: 'column' },
        React.createElement(Text, { color: 'cyan', bold: true }, heading),
        React.createElement(Text, { dimColor: true }, helpText),
        React.createElement(
            Box,
            { marginTop: 1, flexDirection: 'column' },
            React.createElement(Text, null, `Search: ${query || '—'}`),
            React.createElement(
                Text,
                { dimColor: true },
                'Type to filter by folder, title, author, or path. Esc clears, Esc again quits.',
            ),
        ),
        React.createElement(
            Box,
            { marginTop: 1, flexDirection: 'column' },
            filteredOptions.length === 0
                ? React.createElement(
                      Text,
                      { color: 'yellow' },
                      query ? `No presentations match "${query}".` : 'No presentations found.',
                  )
                : filteredOptions.map((option: PresentationOption, index: number) =>
                      React.createElement(PresentationRow, {
                          key: createPresentationKey(option),
                          option,
                          active: index === selectedIndex,
                      }),
                  ),
        ),
    );
}

interface PresentationRowProps {
    option: PresentationOption;
    active: boolean;
}

function PresentationRow({ option, active }: PresentationRowProps) {
    const display = formatPresentationListItem(option);
    const prefix = active ? '›' : ' ';

    return React.createElement(
        Box,
        { flexDirection: 'column', marginBottom: 1 },
        React.createElement(
            Text,
            { color: active ? 'green' : undefined },
            `${prefix} ${display.primary}${display.secondary ? ` (${display.secondary})` : ''}`,
        ),
        display.meta.length > 0
            ? React.createElement(Text, { dimColor: true }, `  ${display.meta.join(' · ')}`)
            : null,
    );
}

function filterOptions(options: PresentationOption[], query: string): PresentationOption[] {
    const normalizedQuery = query.trim();
    if (!normalizedQuery) {
        return [...options].sort(compareDefaultOrder);
    }

    return options
        .map((option) => ({
            option,
            score: matchPresentationSearch(option, normalizedQuery),
        }))
        .filter((entry) => entry.score > 0)
        .sort((left, right) => right.score - left.score || compareDefaultOrder(left.option, right.option))
        .map((entry) => entry.option);
}

function compareDefaultOrder(left: PresentationOption, right: PresentationOption): number {
    if (left.date && right.date && left.date !== right.date) {
        return right.date.localeCompare(left.date);
    }

    if (left.date && !right.date) {
        return -1;
    }

    if (!left.date && right.date) {
        return 1;
    }

    return left.folder.localeCompare(right.folder);
}

function resolvePreselectedOption(
    options: PresentationOption[],
    preselectedFolder: string,
): PresentationOption | null {
    const exactMatch =
        options.find((option) => option.folder === preselectedFolder) ??
        options.find((option) => option.workspace === preselectedFolder) ??
        options.find((option) => option.title === preselectedFolder);

    if (exactMatch) {
        return exactMatch;
    }

    const ranked = filterOptions(options, preselectedFolder);
    return ranked[0] ?? null;
}

function createOptionFromMetadata(
    meta: PresentationMetadata,
    action: PresentationAction,
): PresentationOption | null {
    if (!meta.availableActions.includes(action)) {
        return null;
    }

    if (meta.workspace && meta.scripts[action]) {
        return {
            folder: meta.folder,
            presentationDir: meta.presentationDir,
            workspace: meta.workspace,
            title: meta.title,
            date: meta.date,
            author: meta.author,
            run: {
                type: 'workspace',
                workspace: meta.workspace,
                action,
            },
            slidesPath: meta.slidesPath,
            relativeSlidesPath: meta.relativeSlidesPath,
        };
    }

    if (meta.slidesPath) {
        return {
            folder: meta.folder,
            presentationDir: meta.presentationDir,
            workspace: meta.workspace,
            title: meta.title,
            date: meta.date,
            author: meta.author,
            run: {
                type: 'slides',
                slidesPath: meta.slidesPath,
                relativeSlidesPath: meta.relativeSlidesPath ?? undefined,
                action,
            },
            slidesPath: meta.slidesPath,
            relativeSlidesPath: meta.relativeSlidesPath,
        };
    }

    return null;
}
