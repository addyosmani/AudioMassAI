import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.1/dist/transformers.min.js';

// Skip local model check
env.allowLocalModels = false;

// Use the Singleton pattern to enable lazy construction of the pipeline.
class PipelineSingleton {
    static task = 'automatic-speech-recognition';
    static model = 'Xenova/whisper-tiny.en';
    static instance = null;

    static async getInstance(progress_callback = null) {
        if (this.instance === null) {
            this.instance = pipeline(this.task, this.model, { progress_callback });
        }
        return this.instance;
    }
}

self.addEventListener('message', async (event) => {
    const { audio } = event.data;

    if (!audio) {
        self.postMessage({
            status: 'error',
            message: 'No audio data received.',
        });
        return;
    }

    try {
        // Get the pipeline instance
        const transcriber = await PipelineSingleton.getInstance((progress) => {
            self.postMessage(progress);
        });

        // Transcribe the audio
        const output = await transcriber(audio, {
            chunk_length_s: 30,
            stride_length_s: 5,
        });

        // Send the transcription result back to the main thread
        self.postMessage({
            status: 'complete',
            output: output,
        });
    } catch (error) {
        self.postMessage({
            status: 'error',
            message: error.message,
        });
    }
});
