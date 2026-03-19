import { Box, render, Text, useInput } from 'ink';
import type { Instance } from 'ink';
import SelectInput from 'ink-select-input';
import React, { useMemo } from 'react';
import {
    loadPresentationMetadata,
    type PresentationAction,
    type PresentationMetadata,
} from '../presentation/metadata-loader.js';
import { createPresentationKey, formatPresentationLabel } from '../presentation/presentation-helpers.js';

export { loadPresentationMetadata };
export type { PresentationAction };

export interface SelectPresentationOptions {
    action: PresentationAction;
    heading: string;
    helpText: string;
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
    presentationsDir,
    preselectedFolder,
}: SelectPresentationOptions): Promise<SelectPresentationResult> {
    const metadata = await loadPresentationMetadata(undefined, presentationsDir);
    const options = metadata
        .map((meta) => createOptionFromMetadata(meta, action))
        .filter((opt): opt is PresentationOption => opt !== null);

    if (options.length === 0) {
        return { options, selected: null, cancelled: false };
    }

    if (preselectedFolder) {
        const selected = options.find((option) => option.folder === preselectedFolder) ?? null;
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
    useInput((input, key) => {
        if (input === 'q' || key.escape) {
            onCancel();
        }
    });

    const items = useMemo(
        () =>
            options.map((option) => ({
                label: formatPresentationLabel(option),
                value: option,
                key: createPresentationKey(option),
            })),
        [options],
    );

    return React.createElement(
        Box,
        { flexDirection: 'column' },
        React.createElement(Text, { color: 'cyan', bold: true }, heading),
        React.createElement(Text, { dimColor: true }, helpText),
        React.createElement(
            Box,
            { marginTop: 1 },
            React.createElement(SelectInput, {
                items,
                onSelect: (item) => onSelect(item.value as PresentationOption),
            }),
        ),
    );
}

function createOptionFromMetadata(
    meta: PresentationMetadata,
    action: PresentationAction,
): PresentationOption | null {
    if (!meta.availableActions.includes(action)) {
        return null;
    }

    if (action === 'dev' && meta.slidesPath) {
        return {
            folder: meta.folder,
            presentationDir: meta.presentationDir,
            workspace: meta.workspace,
            title: meta.title,
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

    if (meta.workspace && meta.scripts[action]) {
        return {
            folder: meta.folder,
            presentationDir: meta.presentationDir,
            workspace: meta.workspace,
            title: meta.title,
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
