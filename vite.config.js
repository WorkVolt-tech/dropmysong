import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { cpSync, copyFileSync, existsSync, mkdirSync } from 'node:fs';

// Transitional multipage build. Existing guest/DJ/host/karaoke logic is
// preserved while individual screens are migrated to React safely.
function legacyPwaAssets() {
  return {
    name: 'dropmysong-legacy-pwa-assets',
    closeBundle() {
      const out = resolve('dist');
      for (const file of ['sw.js', 'manifest.webmanifest']) {
        if (existsSync(resolve(file))) copyFileSync(resolve(file), resolve(out, file));
      }
      // Keep original module URLs available to the existing PWA cache.
      for (const directory of ['js', 'css', 'assets']) {
        if (existsSync(resolve(directory))) {
          mkdirSync(resolve(out, directory), { recursive: true });
          cpSync(resolve(directory), resolve(out, directory), { recursive: true });
        }
      }
    },
  };
}

export default defineConfig({
  base: '/',
  plugins: [legacyPwaAssets()],
  build: {
    rollupOptions: {
      input: {
        index: resolve('index.html'),
        dj: resolve('dj.html'),
        host: resolve('host.html'),
        karaoke: resolve('karaoke.html'),
      },
      external: id => /^https?:\/\//.test(id),
    },
  },
});
