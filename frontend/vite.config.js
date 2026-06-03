import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
export default defineConfig({
    plugins: [react()],
    resolve: {
        alias: { "@": path.resolve(__dirname, "src") },
    },
    server: {
        host: true,
        port: 5174,
        strictPort: true,
        proxy: {
            "/api": { target: "http://localhost:8000", changeOrigin: true },
        },
    },
    build: {
        outDir: "dist",
        sourcemap: false,
    },
});
