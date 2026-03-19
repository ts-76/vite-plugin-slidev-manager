import { defineConfig } from 'vite';
import presentationManager from 'vite-plugin-slidev-manager';

export default defineConfig({
    plugins: [presentationManager()],
});
