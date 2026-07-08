import js from '@eslint/js';
import globals from 'globals';
import eslintConfigPrettier from 'eslint-config-prettier';

export default [
  {
    ignores: [
      'dist/',
      'node_modules/',
      // Vendored third-party libraries are linted upstream, not here.
      'public/vendor/',
      'temp/',
    ],
  },

  js.configs.recommended,

  // Application source: browser ES modules.
  {
    files: [
      'src/**/*.js',
      'tests/**/*.js',
      'vite.config.js',
      'vitest.config.js',
      'playwright.config.js',
      'eslint.config.js',
    ],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.browser,
        // Vendored globals loaded via classic <script> tags (see index.html).
        WaveSurfer: 'readonly',
        lz4BlockCodec: 'readonly',
      },
    },
    rules: {
      // The ported legacy modules intentionally keep some defensive patterns.
      'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
    },
  },

  // Modules ported from the legacy AudioMass codebase keep their var-based
  // style; `no-redeclare` would flag legal var redeclarations pervasive there.
  {
    files: [
      'src/audio/audio-engine.js',
      'src/audio/audio-utils.js',
      'src/audio/id3-reader.js',
      'src/ui/editor-ui.js',
      'src/ui/effects-ui.js',
      'src/effects/**/*.js',
    ],
    languageOptions: {
      globals: {
        // Exposed by the lazily loaded RNNoise vendor script.
        wasm_denoise_stream_perf: 'readonly',
        Module: 'readonly',
      },
    },
    rules: {
      'no-redeclare': 'off',
      'no-empty': 'off',
      // The adapted ID3 parser uses assignment-in-condition scanning loops
      // and raw hasOwnProperty checks.
      'no-cond-assign': 'off',
      'no-prototype-builtins': 'off',
    },
  },

  // Encoder workers: classic worker scripts using importScripts().
  {
    files: ['public/workers/*.worker.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'script',
      globals: {
        ...globals.worker,
        // Provided by the vendored libraries the workers importScripts().
        lamejs: 'readonly',
        Flac: 'readonly',
      },
    },
  },

  // AI workers: ES module workers (import from CDN at runtime).
  {
    files: ['public/workers/transcription.worker.js', 'public/workers/summarization.worker.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.worker,
      },
    },
  },

  eslintConfigPrettier,
];
