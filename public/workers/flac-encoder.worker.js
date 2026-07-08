/**
 * FLAC encoder worker.
 *
 * Encodes raw 16-bit PCM samples to FLAC using the vendored libflac.js
 * (Emscripten) build.
 *
 * Protocol:
 *  1. First message:  { sample_rate, flac_compression, channels } — configures
 *     and initializes the encoder.
 *  2. Second message: ArrayBuffer with left-channel (or mono) Int16 samples.
 *  3. Third message (stereo only): ArrayBuffer with right-channel Int16 samples.
 *  Progress is reported back as { percentage } messages; the final message is
 *  the encoded audio as a Blob.
 */

// Tell libflac where to find its .wasm file before loading it.
self.FLAC_SCRIPT_LOCATION = '/vendor/';
importScripts('../vendor/libflac.js');

var flacEncoder;
var isEncoderInitialized = false;
var sampleRate = 44100;
var compressionLevel = 5; // FLAC compression level (0-8).
var channelCount = 1;
var encodedChunks = [];
var encodedByteCount = 0;
var awaitingFirstBuffer = true;
var leftChannelSamples = null;
var rightChannelSamples = null;

function initEncoder() {
  if (isEncoderInitialized) return true;

  // Args: sample rate, channels, bits/sample, compression, total samples (0 =
  // unknown), verify, block size (0 = auto).
  flacEncoder = Flac.create_libflac_encoder(
    sampleRate,
    channelCount,
    16,
    compressionLevel,
    0,
    true,
    0
  );
  if (flacEncoder != 0) {
    var status = Flac.init_encoder_stream(flacEncoder, function (buffer) {
      encodedChunks.push(new Uint8Array(buffer));
      encodedByteCount += buffer.byteLength;
    });

    isEncoderInitialized = true;
    return status == 0;
  }

  return false;
}

function interleave(leftSamples, rightSamples) {
  var length = leftSamples.length + rightSamples.length;
  var result = new Int32Array(length);

  var writeIndex = 0;
  var readIndex = 0;

  while (writeIndex < length) {
    result[writeIndex++] = leftSamples[readIndex];
    result[writeIndex++] = rightSamples[readIndex];
    ++readIndex;
  }
  return result;
}

onmessage = function (event) {
  if (!event.data) return;

  // Configuration message.
  if (event.data.sample_rate) {
    sampleRate = event.data.sample_rate / 1;
    compressionLevel = event.data.flac_compression;
    channelCount = event.data.channels / 1;

    initEncoder();
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

  if (!isEncoderInitialized) {
    postMessage({ percentage: 0 });
    return;
  }

  postMessage({ percentage: 50 });

  if (channelCount > 1) {
    var interleaved = interleave(leftChannelSamples, rightChannelSamples);
    Flac.FLAC__stream_encoder_process_interleaved(
      flacEncoder,
      interleaved,
      leftChannelSamples.length
    );
  } else {
    // libflac expects Int32 sample arrays.
    var monoSamples = new Int32Array(leftChannelSamples.length);
    var index = 0;
    while (index < leftChannelSamples.length) {
      monoSamples[index] = leftChannelSamples[index];
      ++index;
    }
    Flac.FLAC__stream_encoder_process(flacEncoder, [monoSamples], leftChannelSamples.length);
  }

  Flac.FLAC__stream_encoder_finish(flacEncoder);

  // Combine all encoded chunks into a single buffer.
  var outputData = new Uint8Array(encodedByteCount);
  var offset = 0;
  for (var i = 0; i < encodedChunks.length; i++) {
    outputData.set(encodedChunks[i], offset);
    offset += encodedChunks[i].length;
  }

  postMessage(new Blob([outputData], { type: 'audio/flac' }));

  Flac.FLAC__stream_encoder_delete(flacEncoder);
  isEncoderInitialized = false;
  encodedChunks = [];
  encodedByteCount = 0;
};
