/**
 * WAV encoder worker.
 *
 * Wraps raw 16-bit PCM samples in a RIFF/WAVE container.
 *
 * Protocol:
 *  1. First message:  { sample_rate, kbps, channels } — configures the encoder.
 *  2. Second message: ArrayBuffer with left-channel (or mono) Int16 samples.
 *  3. Third message (stereo only): ArrayBuffer with right-channel Int16 samples.
 *  The final message posted back is the encoded audio as a Blob.
 */

function interleave(leftSamples, rightSamples) {
  var length = leftSamples.length + rightSamples.length;
  var result = new Int16Array(length);

  var writeIndex = 0;
  var readIndex = 0;

  while (writeIndex < length) {
    result[writeIndex++] = leftSamples[readIndex];
    result[writeIndex++] = rightSamples[readIndex];
    ++readIndex;
  }
  return result;
}

function writeSamples(view, offset, samples) {
  for (var i = 0; i < samples.length; i++, offset += 2) {
    view.setInt16(offset, samples[i], true);
  }
}

function writeString(view, offset, text) {
  for (var i = 0; i < text.length; i++) {
    view.setUint8(offset + i, text.charCodeAt(i));
  }
}

function encodeWav(samples, channelCount, sampleRate) {
  var buffer = new ArrayBuffer(44 + samples.length * 2);
  var view = new DataView(buffer);

  /* RIFF identifier */
  writeString(view, 0, 'RIFF');
  /* RIFF chunk length */
  view.setUint32(4, 36 + samples.length * 2, true);
  /* RIFF type */
  writeString(view, 8, 'WAVE');
  /* format chunk identifier */
  writeString(view, 12, 'fmt ');
  /* format chunk length */
  view.setUint32(16, 16, true);
  /* sample format (raw) */
  view.setUint16(20, 1, true);
  /* channel count */
  view.setUint16(22, channelCount, true);
  /* sample rate */
  view.setUint32(24, sampleRate, true);
  /* byte rate (sample rate * block align) */
  view.setUint32(28, sampleRate * channelCount * 2, true);
  /* block align (channel count * bytes per sample) */
  view.setUint16(32, channelCount * 2, true);
  /* bits per sample */
  view.setUint16(34, 16, true);
  /* data chunk identifier */
  writeString(view, 36, 'data');
  /* data chunk length */
  view.setUint32(40, samples.length * 2, true);

  writeSamples(view, 44, samples);

  return view;
}

var sampleRate = 44100;
var channelCount = 1;

var leftChannelSamples = null;
var rightChannelSamples = null;
var awaitingFirstBuffer = true;

onmessage = function (event) {
  if (!event.data) return;

  // Configuration message.
  if (event.data.sample_rate) {
    sampleRate = event.data.sample_rate / 1;
    channelCount = event.data.channels / 1;
    return;
  }

  if (awaitingFirstBuffer) {
    leftChannelSamples = new Int16Array(event.data, 0);
    awaitingFirstBuffer = false;

    // Stereo input: wait for the right channel before encoding.
    if (channelCount > 1) return;
  }

  if (event.data && channelCount > 1) {
    rightChannelSamples = new Int16Array(event.data, 0);
  }

  var samples =
    channelCount > 1 ? interleave(leftChannelSamples, rightChannelSamples) : leftChannelSamples;

  var wavView = encodeWav(samples, channelCount, sampleRate);
  postMessage(new Blob([wavView], { type: 'audio/wav' }));
};
