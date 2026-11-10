import { createReadStream, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
// @ts-expect-error - the shared operator script is plain ESM, not a TypeScript module.
import { securityHeaderRecord } from '../scripts/browser-rendering/security-headers.mjs';

const frontendRoot = fileURLToPath(new URL('.', import.meta.url));
const assetRoot = resolve(frontendRoot, 'browser-rendering-assets');

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.whl': 'application/octet-stream',
  '.zip': 'application/zip',
  '.py': 'text/plain; charset=utf-8',
  '.ttc': 'font/collection',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
};

/**
 * Renderer-only development asset server. It is registered only for `--mode renderer`
 * so the main 5173 server keeps its normal proxy and never serves pinned renderer
 * assets. Production copies these assets with the shared build script instead.
 */
function serveRendererAssets(): Plugin {
  return {
    name: 'manimcat-browser-renderer-assets',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/browser-rendering', (request, response, next) => {
        let url: string;
        try {
          url = decodeURIComponent((request.url ?? '/').split('?')[0] ?? '/');
        } catch {
          response.statusCode = 400;
          response.end('Bad Request');
          return;
        }
        const relative = url.replace(/^\/+/, '');
        const file = resolve(assetRoot, relative);
        if (file !== assetRoot && !file.startsWith(`${assetRoot}${sep}`)) {
          response.statusCode = 403;
          response.end('Forbidden');
          return;
        }
        let isFile = false;
        try {
          isFile = statSync(file).isFile();
        } catch {
          isFile = false;
        }
        if (!isFile) {
          next();
          return;
        }
        response.setHeader('Content-Type', MIME[extname(file).toLowerCase()] ?? 'application/octet-stream');
        response.setHeader('Cache-Control', 'no-store');
        createReadStream(file).pipe(response);
      });
    },
  };
}

const mainOrigin =
  process.env.BROWSER_RENDERER_MAIN_ORIGIN?.trim() || 'http://localhost:5173';

export default defineConfig(({ mode }) => {
  const renderer = mode === 'renderer';
  return {
    base: '/',
    plugins: [react(), ...(renderer ? [serveRendererAssets()] : [])],
    worker: {
      format: 'es',
    },
    test: {
      environment: 'jsdom',
      setupFiles: './src/test/setup.ts',
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
      css: false,
      coverage: {
        provider: 'v8',
        reporter: ['text', 'html'],
      },
    },
    build: {
      outDir: '../public',
      emptyOutDir: true,
      rollupOptions: {
        output: {
          assetFileNames: 'assets/[name]-[hash][extname]',
          chunkFileNames: 'assets/[name]-[hash].js',
          entryFileNames: 'assets/[name]-[hash].js',
        },
      },
    },
    resolve: {
      alias: {
        '@': resolve(frontendRoot, 'src'),
      },
    },
    server: renderer
      ? {
          port: 5174,
          strictPort: true,
          // No main /api, /videos or /images proxy on the renderer origin.
          headers: securityHeaderRecord(mainOrigin),
        }
      : {
          port: 5173,
          proxy: {
            '/api': {
              target: 'http://localhost:3000',
              changeOrigin: true,
            },
            '/videos': {
              target: 'http://localhost:3000',
              changeOrigin: true,
            },
            '/images': {
              target: 'http://localhost:3000',
              changeOrigin: true,
            },
          },
        },
  };
});
