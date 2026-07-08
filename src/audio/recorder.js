/**
 * Microphone recorder.
 *
 * Captures audio through getUserMedia + ScriptProcessor, streams the incoming
 * buffers to the waveform for a live preview, and hands the recorded chunks
 * back through the caller's callbacks when recording stops. If the microphone
 * sample rate differs from the loaded track, the recording is resampled.
 */
export class Recorder {
  constructor(app) {
    const recorder = this;

    let mediaStreamSource = null;
    let audioStream = null;
    let audioContext = null;
    let scriptProcessor = null;

    const BUFFER_SIZE = 2048 * 2;
    const INPUT_CHANNELS = 1;
    const OUTPUT_CHANNELS = 1;

    let isActive = false;

    let startingOffset = 0;
    let endingOffset = 0;

    let sampleRate = 0;

    let recordedChunks = [];
    let recordedChunkIndex = -1;
    let framesUntilRedraw = 1;

    let onRecordingEnd = null;
    let onRecordingStart = null;

    let currentOffset = 0;
    // Skip the first few buffers so the click of the record button
    // does not end up in the recording.
    let buffersToSkip = 8;

    const captureAudioChunk = function (event) {
      if (buffersToSkip > 0) {
        --buffersToSkip;
        return;
      }

      currentOffset += event.inputBuffer.duration * sampleRate;
      if (endingOffset <= currentOffset) {
        endingOffset > 0 && recorder.stop();
        return;
      }

      recordedChunks[++recordedChunkIndex] = event.inputBuffer.getChannelData(0).slice(0);

      // Redraw the live preview roughly every 4 chunks.
      if (--framesUntilRedraw === 0) {
        requestAnimationFrame(function () {
          framesUntilRedraw = 4;
          app.engine.wavesurfer.DrawTemp(startingOffset, recordedChunks);
        });
      }
    };

    this.isActive = function () {
      return isActive;
    };

    this.setEndingOffset = function (endingOffsetSeconds) {
      endingOffset = endingOffsetSeconds;
    };

    /**
     * Start recording.
     *
     * @param {number}   atOffset          Sample offset to record into.
     * @param {Function} endCallback       Called with (offsetSeconds, chunks) when done.
     * @param {Function} startCallback     Called once recording actually begins.
     * @param {number}   [inputSampleRate] Overrides the detected sample rate.
     */
    this.start = function (atOffset, endCallback, startCallback, inputSampleRate) {
      if (isActive) return false;
      if (!navigator.mediaDevices) {
        app.fireEvent('ErrorRec');
        app.fireEvent('ShowError', 'No recording device found');
        return false;
      }

      startingOffset = atOffset / 1;
      if (isNaN(startingOffset) || !startingOffset) startingOffset = 0;
      currentOffset = startingOffset;

      audioContext = app.engine.wavesurfer.backend.getAudioContext();
      if (!audioContext) {
        app.fireEvent('ErrorRec');
        app.fireEvent('ShowError', 'No recording device found');
        return false;
      }

      // Nudge suspended contexts awake (autoplay policies).
      if (audioContext.currentTime === 0) {
        app.engine.wavesurfer.backend.source.start(0);
        app.engine.wavesurfer.backend.source.stop(0);
      }

      if (!inputSampleRate) {
        if (app.engine.wavesurfer.backend.buffer) {
          sampleRate = app.engine.wavesurfer.backend.buffer.sampleRate;
        } else {
          sampleRate = audioContext.sampleRate;
        }
      }

      onRecordingEnd = function (offset, chunks, markInactive) {
        async function downsampleAudioBuffer(chunks, sourceSampleRate, targetSampleRate) {
          // Concatenate the Float32Array chunks.
          const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
          const concatenated = new Float32Array(totalLength);
          let writeOffset = 0;
          for (let i = 0; i < chunks.length; i++) {
            concatenated.set(chunks[i], writeOffset);
            writeOffset += chunks[i].length;
          }

          // Build an AudioBuffer at the source rate...
          const tempContext = new AudioContext({ sampleRate: sourceSampleRate });
          const audioBuffer = tempContext.createBuffer(1, totalLength, sourceSampleRate);
          audioBuffer.copyToChannel(concatenated, 0, 0);
          tempContext.close();

          // ...and resample it offline to the target rate.
          const resampledLength = Math.ceil(audioBuffer.duration * targetSampleRate);
          const offlineContext = new OfflineAudioContext(1, resampledLength, targetSampleRate);

          const source = offlineContext.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(offlineContext.destination);
          source.start(0);

          const renderedBuffer = await offlineContext.startRendering();
          return renderedBuffer.getChannelData(0);
        }

        const sourceSampleRate = audioContext ? audioContext.sampleRate : 48000;
        if (sourceSampleRate === sampleRate) {
          markInactive();
          endCallback(offset, chunks);
          return;
        }

        downsampleAudioBuffer(chunks, sourceSampleRate, sampleRate)
          .then((resampled) => {
            markInactive();
            endCallback(offset, [resampled]);
          })
          .catch((error) => {
            markInactive();
            console.error('Error during downsampling:', error);
          });
      };
      onRecordingStart = startCallback;

      navigator.mediaDevices
        .getUserMedia({ audio: true, video: false })
        .then(function (stream) {
          audioStream = stream;
          mediaStreamSource = audioContext.createMediaStreamSource(stream);

          scriptProcessor = audioContext.createScriptProcessor(
            BUFFER_SIZE,
            INPUT_CHANNELS,
            OUTPUT_CHANNELS
          );

          mediaStreamSource.connect(scriptProcessor);
          scriptProcessor.connect(audioContext.destination);

          isActive = true;
          onRecordingStart && onRecordingStart();

          scriptProcessor.onaudioprocess = captureAudioChunk;
        })
        .catch(function (error) {
          app.fireEvent('ErrorRec');

          if (error && error.message) {
            app.fireEvent('ShowError', error.message);
          }
        });

      return true;
    };

    this.stop = function (cancelRecording) {
      if (!isActive) return;

      audioStream.getTracks().forEach(function (track) {
        track.stop();
      });

      scriptProcessor.onaudioprocess = null;
      mediaStreamSource.disconnect();
      scriptProcessor.disconnect();

      app.engine.wavesurfer.DrawTemp(null);

      if (recordedChunks.length > 0 && !cancelRecording) {
        onRecordingEnd &&
          onRecordingEnd(startingOffset / sampleRate, recordedChunks, function () {
            isActive = false;
          });
      } else {
        onRecordingEnd &&
          onRecordingEnd(null, null, function () {
            isActive = false;
          });
      }

      sampleRate = 0;
      buffersToSkip = 8;
      framesUntilRedraw = 1;
      recordedChunkIndex = -1;
      startingOffset = endingOffset = 0;
      recordedChunks = [];
      audioStream = null;
      audioContext = null;
      onRecordingEnd = onRecordingStart = null;
    };
  }
}
