import type { PresentationAction } from './presentation-selector.js';

export function getHeading(action: PresentationAction): string {
    if (action === 'dev') {
        return 'Select a Slidev presentation to run';
    }

    if (action === 'build') {
        return 'Select a Slidev presentation to build';
    }

    return 'Select a Slidev presentation to export';
}

export function getHelpText(action: PresentationAction): string {
    if (action === 'dev') {
        return 'Use arrow keys to pick a presentation, press Enter to launch, or Q to cancel.';
    }

    if (action === 'build') {
        return 'Use arrow keys to pick a presentation, press Enter to build, or Q to cancel.';
    }

    return 'Use arrow keys to pick a presentation, press Enter to open the browser exporter, or Q to cancel.';
}
