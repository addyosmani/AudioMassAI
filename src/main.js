/**
 * Application entry point.
 */

import './styles/main.css';
import { AudioEditor } from './core/audio-editor.js';

const editor = new AudioEditor();

// The patched wavesurfer vendor build (loaded via <script> in index.html)
// calls back into the editor through this global; set it before init so the
// bridge exists as soon as wavesurfer starts emitting events.
window.PKAudioEditor = editor;

editor.init('app');
