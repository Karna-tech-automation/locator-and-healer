import { defineConfig, type Plugin } from 'vite';
import { build as esbuild } from 'esbuild';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyFileSync, mkdirSync } from 'node:fs';
/// <reference types="vite/client" />
const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Bundles content.ts and inject.ts as IIFE.
 * Manifest V3 content scripts and page-world injected scripts CANNOT use ESM.
 */
const iifeBundles = (): Plugin => ({
  name: 'locator-healer:iife-bundles',
  async closeBundle() {
    await esbuild({
      entryPoints: {
        content: resolve(__dirname, 'src/content/content.ts'),
        inject: resolve(__dirname, 'src/inject/inject.ts'),
      },
      bundle: true,
      format: 'iife',
      target: 'chrome120',
      outdir: resolve(__dirname, 'dist'),
      sourcemap: true,
      logLevel: 'info',
    });
  },
});

/**
 * Copies manifest.json and the icon into dist/.
 * Vite's publicDir handles HTML/CSS copies; manifest lives at root by convention.
 */
const copyStatic = (): Plugin => ({
  name: 'locator-healer:copy-static',
  closeBundle() {
    const files: ReadonlyArray<readonly [string, string]> = [
      ['manifest.json', 'dist/manifest.json'],
      ['assets/icon128.png', 'dist/assets/icon128.png'],
    ];
    for (const [src, dest] of files) {
      const destPath = resolve(__dirname, dest);
      mkdirSync(dirname(destPath), { recursive: true });
      copyFileSync(resolve(__dirname, src), destPath);
    }
  },
});

export default defineConfig({
  publicDir: 'public',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'chrome120',
    sourcemap: true,
    rollupOptions: {
      input: {
        panel: resolve(__dirname, 'src/panel/panel.ts'),
        service_worker: resolve(__dirname, 'src/background/service_worker.ts'),
      },
      output: {
        entryFileNames: '[name].js',
        chunkFileNames: 'chunks/[name]-[hash].js',
        assetFileNames: (assetInfo) => {
          if (assetInfo.name === 'style.css') return 'panel.css';
          return 'assets/[name]-[hash][extname]';
        },
        format: 'es',
      },
    },
  },
  plugins: [iifeBundles(), copyStatic()],
});