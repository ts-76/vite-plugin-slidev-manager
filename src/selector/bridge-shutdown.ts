export function registerBridgeShutdown(bridge: { stop(): Promise<void> }) {
    process.once('SIGINT', async () => {
        await bridge.stop();
        process.exit(130);
    });

    process.once('SIGTERM', async () => {
        await bridge.stop();
        process.exit(143);
    });
}
