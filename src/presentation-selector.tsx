import { Box, render, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import React, { useMemo } from 'react';
import {
    loadPresentationMetadata,
    type PresentationMetadata,
} from './metadata-loader.js';

export { loadPresentationMetadata };

export interface SelectPresentationOptions {
    action: 'dev' | 'export';
    heading: string;
    helpText: string;
    presentationsDir?: string;
}

export interface SelectPresentationResult {
    options: PresentationOption[];
    selected: PresentationOption | null;
    cancelled: boolean;
}

export interface PresentationOption {
    folder: string;
    workspace: string | null;
    title: string | null;
    run: {
        type: 'workspace' | 'slides';
        workspace?: string;
        slidesPath?: string;
        relativeSlidesPath?: string;
        action: 'dev' | 'export';
    };
    slidesPath: string | null;
    relativeSlidesPath: string | null;
}

export async function selectPresentation({
    action,
    heading,
    helpText,
    presentationsDir,
}: SelectPresentationOptions): Promise<SelectPresentationResult> {
    const metadata = await loadPresentationMetadata(undefined, presentationsDir);
    const options = metadata
        .map((meta) => createOptionFromMetadata(meta, action))
        .filter((opt): opt is PresentationOption => opt !== null);

    if (options.length === 0) {
        return { options, selected: null, cancelled: false };
    }

    let selected: PresentationOption | null = null;
    let cancelled = false;

    // biome-ignore lint/suspicious/noExplicitAny: Ink app instance type is complex
    let app: any;
    const handleSelect = (option: PresentationOption) => {
        selected = option;
        if (app) {
            app.unmount();
        }
    };
    const handleCancel = () => {
        cancelled = true;
        if (app) {
            app.unmount();
        }
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

    return { options, selected, cancelled };
}

interface SelectorProps {
    options: PresentationOption[];
    heading: string;
    helpText: string;
    action: 'dev' | 'export';
    onSelect: (option: PresentationOption) => void;
    onCancel: () => void;
}

function Selector({
    options,
    heading,
    helpText,
    action,
    onSelect,
    onCancel,
}: SelectorProps) {
    useInput((input, key) => {
        if (input === 'q' || key.escape) {
            if (onCancel) {
                onCancel();
            }
        }
    });

    const items = useMemo(
        () =>
            options.map((option) => ({
                label: formatLabel(option),
                value: option,
                key: createKey(option, action),
            })),
        [options, action],
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
    action: 'dev' | 'export',
): PresentationOption | null {
    if (meta.workspace && meta.scripts?.[action]) {
        return {
            folder: meta.folder,
            workspace: meta.workspace,
            title: meta.title,
            run: {
                type: 'workspace',
                workspace: meta.workspace ?? undefined,
                action,
            },
            slidesPath: meta.slidesPath,
            relativeSlidesPath: meta.relativeSlidesPath,
        };
    }

    if (meta.slidesPath) {
        return {
            folder: meta.folder,
            workspace: meta.workspace,
            title: meta.title,
            run: {
                type: 'slides',
                slidesPath: meta.slidesPath ?? undefined,
                relativeSlidesPath: meta.relativeSlidesPath ?? undefined,
                action,
            },
            slidesPath: meta.slidesPath,
            relativeSlidesPath: meta.relativeSlidesPath,
        };
    }

    return null;
}

function formatLabel(option: PresentationOption): string {
    const workspaceName = option.workspace ?? '';
    const slugFromWorkspace = workspaceName.includes('/')
        ? workspaceName.split('/').pop()
        : workspaceName;

    const baseTitle = option.title ?? option.folder;
    const detail =
        option.run.type === 'workspace'
            ? workspaceName
            : (option.run.relativeSlidesPath ?? '');
    const prefix = option.run.type === 'workspace' ? '[workspace]' : '[slides]';

    if (
        option.run.type === 'workspace' &&
        option.title &&
        slugFromWorkspace &&
        option.title !== slugFromWorkspace
    ) {
        return `${prefix} ${baseTitle} (${slugFromWorkspace})`;
    }

    if (
        option.run.type === 'workspace' &&
        slugFromWorkspace &&
        slugFromWorkspace !== option.folder
    ) {
        return `${prefix} ${option.folder} (${workspaceName})`;
    }

    return `${prefix} ${baseTitle} (${detail})`;
}

function createKey(
    option: PresentationOption,
    action: 'dev' | 'export',
): string {
    const detail =
        option.run.type === 'workspace'
            ? (option.run.workspace ?? option.folder)
            : (option.run.relativeSlidesPath ?? '');
    const key = `${action}::${option.folder}::${option.run.type}::${detail}`;
    return key;
}
