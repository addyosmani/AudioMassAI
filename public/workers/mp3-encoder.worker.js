/**
 * MP3 encoder worker.
 *
 * Encodes raw 16-bit PCM samples to MP3 using the vendored lamejs library.
 *
 * Protocol:
 *  1. First message:  { sample_rate, kbps, channels } — configures the encoder.
 *  2. Second message: ArrayBuffer with left-channel (or mono) Int16 samples.
 *  3. Third message (stereo only): ArrayBuffer with right-channel Int16 samples.
 *  Progress is reported back as { percentage } messages; the final message is
 *  the encoded audio as a Blob.
 */

importScripts('../vendor/lame.js');

var sampleRate = 44100;
var bitrateKbps = 128;
var channelCount = 1;
var mp3Encoder = null;

var leftChannelSamples = null;
var rightChannelSamples = null;
var awaitingFirstBuffer = true;

onmessage = function (event) {
  if (!event.data) return;

  // Configuration message.
  if (event.data.sample_rate) {
    sampleRate = event.data.sample_rate / 1;
    bitrateKbps = event.data.kbps / 1;
    channelCount = event.data.channels / 1;
    return;
  }

  if (awaitingFirstBuffer) {
    leftChannelSamples = new Int16Array(event.data);
    awaitingFirstBuffer = false;

    // Stereo input: wait for the right channel before encoding.
    if (channelCount > 1) return;
  }

  if (event.data && channelCount > 1) {
    rightChannelSamples = new Int16Array(event.data);
  }

  if (!mp3Encoder) {
    mp3Encoder = new lamejs.Mp3Encoder(channelCount, sampleRate, bitrateKbps);
  }

  var sampleBlockSize = 1152 * 2;
  var mp3Chunks = [];
  var lastReportedPercentage = 0;

  var leftChunk = null;
  var rightChunk = null;

  for (var offset = 0; offset < leftChannelSamples.length; offset += sampleBlockSize) {
    leftChunk = leftChannelSamples.subarray(offset, offset + sampleBlockSize);

    if (rightChannelSamples) {
      rightChunk = rightChannelSamples.subarray(offset, offset + sampleBlockSize);
    }

    var mp3Buffer = mp3Encoder.encodeBuffer(leftChunk, rightChunk);

    var percentage = ((offset / leftChannelSamples.length) * 100) >> 0;
    if (percentage > lastReportedPercentage) {
      lastReportedPercentage = percentage;
      postMessage({ percentage: percentage });
    }

    if (mp3Buffer.length > 0) {
      mp3Chunks.push(mp3Buffer);
    }
  }

  var finalBuffer = mp3Encoder.flush();
  if (finalBuffer.length > 0) {
    mp3Chunks.push(finalBuffer);
  }

  postMessage(new Blob(mp3Chunks, { type: 'audio/mp3' }));
};
