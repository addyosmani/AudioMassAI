/**
 * AI transcription & summarization feature.
 *
 * Listens for the `RequestTranscription` event, runs the loaded audio through
 * a Whisper model in a web worker, and presents the transcript in a modal.
 * From there the transcript can be exported as a text file or summarized —
 * preferring Chrome's built-in Summarizer API and falling back to a
 * DistilBART model in a worker on other browsers.
 *
 * Both workers live in `public/workers/` and pull their models through
 * transformers.js at runtime, keeping the heavy ML runtime out of the app
 * bundle.
 */

import { SimpleModal } from '../ui/modals.js';

const TRANSCRIPTION_WORKER_URL = '/workers/transcription.worker.js';
const SUMMARIZATION_WORKER_URL = '/workers/summarization.worker.js';

/** Whisper models expect 16 kHz mono input. */
const WHISPER_SAMPLE_RATE = 16000;
const SUMMARIZATION_MODEL_SIZE = '284MB';

const LABEL_SUMMARIZE = 'Summarize';
const LABEL_UNDO = 'Undo';
const TITLE_TRANSCRIPTION_ORIGINAL = 'Transcription (original)';
const TITLE_TRANSCRIPTION_SUMMARY = 'Transcription (summary)';
const ERROR_CANCELLED_BY_USER = 'Summarization cancelled by user';

// --- model download progress UI -------------------------------------------

function createProgressBar(modalBody, modelState) {
  const progressBar = document.createElement('div');
  progressBar.className = 'pk_progress';
  progressBar.id = modelState.file;

  const progressBarInner = document.createElement('div');
  progressBarInner.className = 'pk_progress_bar';

  const fileNameLabel = document.createElement('span');
  fileNameLabel.style.marginLeft = '4px';
  fileNameLabel.style.marginRight = '2px';
  fileNameLabel.textContent = `${modelState.file}`;

  const percentLabel = document.createElement('span');
  percentLabel.style.marginLeft = '2px';
  percentLabel.style.marginRight = '4px';

  progressBarInner.appendChild(fileNameLabel);
  progressBarInner.appendChild(percentLabel);
  progressBar.appendChild(progressBarInner);
  modalBody.appendChild(progressBar);
}

function updateProgressBar(modalBody, modelState) {
  const progressBar = modalBody.querySelector(`#${CSS.escape(modelState.file)}`);
  const progressBarInner = progressBar.querySelector('div');
  progressBarInner.style.width = `${modelState.progress}%`;
  const percentLabel = progressBarInner.querySelector('span:last-child');
  percentLabel.textContent = `(${modelState.progress.toFixed(2)}%)`;
}

function updateSubTitle(modalBody, subTitleText) {
  const subTitle = modalBody.querySelector('p');
  if (subTitle.textContent.trim() !== subTitleText) {
    subTitle.textContent = subTitleText;
  }
}

function removeProgressBars(modalBody) {
  modalBody.querySelectorAll('.pk_progress').forEach((item) => item.remove());
}

// --- button state helpers ---------------------------------------------------

function updateButtonCaption(button, caption) {
  button.innerHTML = caption;
  button.title = caption;
}

function disableButton(button) {
  button.style.pointerEvents = 'none';
  button.setAttribute('aria-disabled', 'true');
}

function enableButton(button) {
  button.style.pointerEvents = '';
  button.setAttribute('aria-disabled', 'false');
}

// --- audio preparation ------------------------------------------------------

/** Average all channels of an AudioBuffer into a single Float32Array. */
function mixDownToMono(audioBuffer) {
  const { numberOfChannels, length } = audioBuffer;

  const mono = new Float32Array(length);
  if (numberOfChannels === 1) {
    mono.set(audioBuffer.getChannelData(0));
  } else {
    for (let channel = 0; channel < numberOfChannels; channel++) {
      const channelData = audioBuffer.getChannelData(channel);
      for (let index = 0; index < length; index++) {
        mono[index] += channelData[index];
      }
    }
    for (let index = 0; index < length; index++) {
      mono[index] /= numberOfChannels;
    }
  }

  return mono;
}

/** Resample a Float32Array to 16 kHz for Whisper. */
async function resampleTo16k(samples, fromSampleRate) {
  const offlineContext = new OfflineAudioContext(
    1,
    Math.ceil((samples.length * WHISPER_SAMPLE_RATE) / fromSampleRate),
    WHISPER_SAMPLE_RATE
  );
  const buffer = offlineContext.createBuffer(1, samples.length, fromSampleRate);
  buffer.copyToChannel(samples, 0);
  const source = offlineContext.createBufferSource();
  source.buffer = buffer;
  source.connect(offlineContext.destination);
  source.start();
  const rendered = await offlineContext.startRendering();
  return rendered.getChannelData(0).slice();
}

// --- summarization ----------------------------------------------------------

/**
 * Feature-detect Chrome's built-in Summarizer API and create a summarizer if
 * the model is available on this machine. Returns null when unsupported.
 */
async function getSummarizerIfReady(options) {
  if (!('Summarizer' in self)) {
    console.log('Summarizer API is not supported in this browser.');
    return null;
  }

  console.log('Summarizer API is supported in this browser.');

  // Availability check (Chrome/Edge only).
  const availability = await self.Summarizer.availability();
  if (availability === 'unavailable') {
    console.warn('Model cannot be used (hardware limitations, OS not supported, etc.).');
    return null;
  }

  console.log('Model can be used.');

  return await self.Summarizer.create(options);
}

/** Summarize with the DistilBART worker (Firefox/Safari fallback). */
function summarizeWithWorker(text, modalBody) {
  console.log('Using T5 fallback summarization for Firefox/Safari');

  return new Promise((resolve, reject) => {
    const summarizationWorker = new Worker(SUMMARIZATION_WORKER_URL, {
      type: 'module',
    });

    summarizationWorker.onmessage = (event) => {
      const { summary, message, ...modelState } = event.data;

      switch (modelState.status) {
        case 'initiate': {
          updateSubTitle(
            modalBody,
            `Loading summarization model (~${SUMMARIZATION_MODEL_SIZE})...`
          );
          createProgressBar(modalBody, modelState);
          break;
        }
        case 'progress': {
          updateProgressBar(modalBody, modelState);
          break;
        }
        case 'done': {
          break;
        }
        case 'ready': {
          updateSubTitle(modalBody, 'Summarizing transcript...');
          removeProgressBars(modalBody);
          break;
        }
        case 'complete': {
          updateSubTitle(modalBody, 'Summarized using offline model (quality may vary)');

          summarizationWorker.terminate();
          resolve(summary);
          break;
        }
        case 'error': {
          summarizationWorker.terminate();
          reject(new Error(message || 'Summarization failed'));
          break;
        }
        default: {
          // no-op
          break;
        }
      }
    };

    summarizationWorker.onerror = (error) => {
      summarizationWorker.terminate();
      reject(new Error('Worker error: ' + error.message));
    };

    summarizationWorker.postMessage({ text });
  });
}

/** Ask the user to confirm the fallback model download, then run it. */
function confirmAndSummarizeWithWorker(app, text, modalBody) {
  return new Promise((resolve, reject) => {
    let isConfirmed = false;
    const confirmationModal = new SimpleModal({
      title: 'Confirm Model Load',
      clss: 'pk_modal_anim',
      body: `<p>Summarization requires loading a ~${SUMMARIZATION_MODEL_SIZE} model. Proceed?</p>`,
      setup: function (modal) {
        app.ui.InteractionHandler.checkAndSet('modal');
        app.ui.KeyHandler.addCallback(
          'modalTemp',
          function () {
            modal.Destroy();
          },
          [27]
        );

        const cancelButton = modal.el.getElementsByClassName('pk_modal_cancel')[0];
        cancelButton.innerHTML = 'No';
      },
      ondestroy: function () {
        app.ui.InteractionHandler.on = false;
        app.ui.KeyHandler.removeCallback('modalTemp');

        if (!isConfirmed) {
          reject(new Error(ERROR_CANCELLED_BY_USER));
        }
      },
      buttons: [
        {
          title: 'Yes',
          clss: 'pk_modal_a_accpt',
          callback: async function (modal) {
            isConfirmed = true;
            modal.Destroy();
            try {
              resolve(await summarizeWithWorker(text, modalBody));
            } catch (error) {
              reject(error);
            }
          },
        },
      ],
    });
    confirmationModal.Show();
  });
}

/**
 * Summarize a transcript: Chrome's built-in Summarizer API when available,
 * otherwise the worker fallback (behind a download confirmation).
 */
async function summarizeTranscript(app, text, modalBody) {
  const summarizer = await getSummarizerIfReady({
    sharedContext: 'This is an audio transcription that has been converted from speech to text.',
    type: 'key-points',
    format: 'plain-text',
    length: 'medium',
    expectedInputLanguages: ['en'],
    outputLanguage: 'en',
    expectedContextLanguages: ['en'],
    monitor(monitor) {
      monitor.addEventListener('download-progress', (event) => {
        console.log(`Downloaded ${event.loaded * 100}%`);
      });
    },
  });

  if (summarizer) {
    // The built-in API must be triggered by a user gesture.
    if (!navigator.userActivation.isActive) {
      throw new Error('User activation required for Summarizer API. Try again.');
    }

    updateSubTitle(modalBody, 'Summarizing transcript...');
    const summary = await summarizer.summarize(text);
    updateSubTitle(modalBody, "Summarized using Chrome's built-in AI summarizer");

    return summary;
  }

  return confirmAndSummarizeWithWorker(app, text, modalBody);
}

// --- transcript modal -------------------------------------------------------

function exportTranscript(modal) {
  const text = modal.el_body.querySelector('textarea').value;
  const blob = new Blob([text], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;

  // When the Undo button is visible the textarea holds the summary.
  const isShowingSummary = Array.from(modal.els.bottom).some(
    (button) => button.innerHTML.trim() === LABEL_UNDO
  );
  link.download = isShowingSummary ? 'transcription_summary.txt' : 'transcription_original.txt';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

async function handleSummarizeClick(app, modal) {
  const summarizeButton = Array.from(modal.els.bottom).find(
    (button) =>
      button.innerHTML.trim() === LABEL_SUMMARIZE || button.innerHTML.trim() === LABEL_UNDO
  );
  const transcriptArea = modal.el_body.querySelector('textarea');
  const transcript = transcriptArea.value;

  // In "Undo" mode the button restores the original transcript.
  if (summarizeButton.innerHTML.trim() === LABEL_UNDO) {
    transcriptArea.value = modal._originalTranscript;
    updateButtonCaption(summarizeButton, LABEL_SUMMARIZE);
    updateSubTitle(modal.el_body, '');
    modal.el_title.innerHTML = TITLE_TRANSCRIPTION_ORIGINAL;
    return;
  }

  modal._originalTranscript = transcript;

  try {
    updateButtonCaption(summarizeButton, 'Summarizing...');
    disableButton(summarizeButton);

    updateSubTitle(modal.el_body, 'Please wait, preparing summarization...');

    const summary = await summarizeTranscript(app, transcript, modal.el_body);

    transcriptArea.value = summary;
    modal.el_title.innerHTML = TITLE_TRANSCRIPTION_SUMMARY;

    updateButtonCaption(summarizeButton, LABEL_UNDO);
    enableButton(summarizeButton);
  } catch (error) {
    updateButtonCaption(summarizeButton, LABEL_SUMMARIZE);
    enableButton(summarizeButton);

    updateSubTitle(modal.el_body, '');
    removeProgressBars(modal.el_body);

    // Don't surface an error when the user simply cancelled.
    if (error?.message !== ERROR_CANCELLED_BY_USER) {
      app.fireEvent(
        'ShowError',
        error?.message || 'An error occurred while summarizing the transcription. Please try again.'
      );
    }
  }
}

function showTranscriptModal(app, transcript) {
  const transcriptionModal = new SimpleModal({
    title: TITLE_TRANSCRIPTION_ORIGINAL,
    clss: 'pk_modal_anim',
    body: `<textarea readonly style="width: 100%; height: 200px;">${transcript}</textarea><p></p>`,
    setup: function (modal) {
      app.ui.InteractionHandler.checkAndSet('modal');
      app.ui.KeyHandler.addCallback(
        'modalTemp',
        function () {
          modal.Destroy();
        },
        [27]
      );
    },
    ondestroy: function () {
      app.ui.InteractionHandler.on = false;
      app.ui.KeyHandler.removeCallback('modalTemp');
    },
    buttons: [
      {
        title: 'Export',
        clss: 'pk_modal_a_accpt',
        callback: exportTranscript,
      },
      {
        title: LABEL_SUMMARIZE,
        clss: 'pk_modal_a_accpt',
        callback: (modal) => handleSummarizeClick(app, modal),
      },
      {
        title: 'Close',
        clss: 'pk_modal_a_accpt',
        callback: function (modal) {
          modal.Destroy();
        },
      },
    ],
  });
  transcriptionModal.Show();
}

// --- feature entry point ----------------------------------------------------

/** Wire the transcription feature into the editor's event bus. */
export function initTranscription(app) {
  app.listenFor('RequestTranscription', async function () {
    const transcriptionWorker = new Worker(TRANSCRIPTION_WORKER_URL, {
      type: 'module',
    });

    const transcribingModal = new SimpleModal({
      title: 'Audio Transcription',
      clss: 'pk_modal_anim',
      body: '<p>Please wait, preparing transcription...</p>',
      setup: function (modal) {
        app.fireEvent('RequestPause');
        app.ui.InteractionHandler.checkAndSet('modal');
        app.ui.KeyHandler.addCallback(
          'modalTemp',
          function () {
            modal.Destroy();
          },
          [27]
        );
      },
      ondestroy: function () {
        app.ui.InteractionHandler.on = false;
        app.ui.KeyHandler.removeCallback('modalTemp');
      },
    });
    transcribingModal.Show();

    transcriptionWorker.onmessage = (event) => {
      const { transcript, message, ...modelState } = event.data;

      switch (modelState.status) {
        case 'initiate': {
          updateSubTitle(transcribingModal.el_body, 'Loading transcription model...');
          createProgressBar(transcribingModal.el_body, modelState);
          break;
        }
        case 'progress': {
          updateProgressBar(transcribingModal.el_body, modelState);
          break;
        }
        case 'done': {
          break;
        }
        case 'ready': {
          updateSubTitle(transcribingModal.el_body, 'Transcribing audio...');
          removeProgressBars(transcribingModal.el_body);
          break;
        }
        case 'complete': {
          updateSubTitle(transcribingModal.el_body, '');
          transcribingModal.Destroy();

          showTranscriptModal(app, transcript);
          transcriptionWorker.terminate();
          break;
        }
        case 'error': {
          transcribingModal.Destroy();
          app.fireEvent('ShowError', `Transcription failed: ${message}`);
          transcriptionWorker.terminate();
          break;
        }
        default: {
          // no-op
          break;
        }
      }
    };

    const audioBuffer = app.engine.wavesurfer.backend.buffer;
    const mono = mixDownToMono(audioBuffer);
    const mono16k = await resampleTo16k(mono, audioBuffer.sampleRate);

    if (
      mono16k instanceof Float32Array &&
      mono16k.buffer instanceof ArrayBuffer &&
      mono16k.length > 0
    ) {
      transcriptionWorker.postMessage({ audio: mono16k, sampling_rate: WHISPER_SAMPLE_RATE }, [
        mono16k.buffer,
      ]);
    } else {
      app.fireEvent('ShowError', `Invalid audio buffer for transfer: ${mono16k}`);
    }
  });
}
