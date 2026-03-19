import type {
    PresentationAction,
    PresentationOption,
    SelectPresentationResult,
} from './presentation-selector.js';

const presentationEnvVar = 'SLIDEV_MANAGER_PRESENTATION';

export function resolveSelection(
    selection: SelectPresentationResult,
    action: PresentationAction,
    preselectedFolder?: string,
): PresentationOption | null {
    const { options, selected, cancelled, reason } = selection;

    if (options.length === 0) {
        console.error(`No Slidev presentations with a ${action} entrypoint were found.`);
        return null;
    }

    if (cancelled) {
        return null;
    }

    if (selected) {
        return selected;
    }

    if (reason === 'preselected') {
        console.error(
            `Presentation "${preselectedFolder}" was not found for the ${action} action.`,
        );
        return null;
    }

    if (reason === 'non-interactive-without-selection') {
        console.error(
            `Cannot ${action} interactively without a TTY. Set ${presentationEnvVar} to a presentation folder name.`,
        );
        return null;
    }

    return null;
}
