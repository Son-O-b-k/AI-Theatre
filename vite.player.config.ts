// The standalone lesson player (src/viewer/standalone.ts) as one script, for SCORM packages.
import { defineConfig } from 'vite'

export default defineConfig({
  // Only the script: the site's public files (landing example, favicon) are not part of it.
  publicDir: false,
  build: {
    outDir: 'dist-player',
    emptyOutDir: true,
    lib: { entry: 'src/viewer/standalone.ts', formats: ['iife'], name: 'AITheatrePlayer', fileName: () => 'player.js' },
  },
})
