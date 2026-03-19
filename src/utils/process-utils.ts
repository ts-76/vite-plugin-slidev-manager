export function restoreTerminalInput(): void {
    if (!process.stdin.isTTY) {
        return;
    }

    process.stdin.removeAllListeners('data');
    process.stdin.removeAllListeners('keypress');
    process.stdin.removeAllListeners('readable');

    if (typeof process.stdin.setRawMode === 'function') {
        process.stdin.setRawMode(false);
    }

    process.stdin.pause();
}

export function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    if (
        typeof error === 'object' &&
        error !== null &&
        'message' in error &&
        typeof error.message === 'string'
    ) {
        return error.message;
    }

    return String(error);
}
