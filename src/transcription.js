// ninja focus touch <
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.1/dist/transformers.min.js';

// Skip local model check
env.allowLocalModels = false;

// Use the Singleton pattern to enable lazy construction of the pipeline
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
    const audioData = event.data;

    if (!audioData || !audioData.audio) {
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
        // const output = await transcriber(audioData, {
        //     // chunk_length_s: 30,
        //     // stride_length_s: 5,
        // });
        const { audio, sampling_rate } = audioData;
        // Ensure Float32Array
        const pcm = audio instanceof Float32Array ? audio : new Float32Array(audio);

        console.log('len', pcm.length, 'rate', sampling_rate);
        let peak = 0, sumsq = 0;
        for (let i = 0; i < pcm.length; i++) { const v = pcm[i]; peak = Math.max(peak, Math.abs(v)); sumsq += v*v; }
        console.log('peak', peak, 'rms', Math.sqrt(sumsq/pcm.length));

        console.log("ninja focus touch: pcm =>", pcm);
        console.log("ninja focus touch: sampling_rate =>", sampling_rate);

        // Try without language constraint first
        const output = await transcriber(pcm, {
            sampling_rate,
            task: 'transcribe',
            return_timestamps: true,
        });

        console.log('ninja focus touch: model =>', transcriber?.model?.name);
        console.log('ninja focus touch: fe sr =>', transcriber?.processor?.feature_extractor?.config?.sampling_rate);
        console.log('ninja focus touch: out keys =>', Object.keys(output || {}));
        console.log('ninja focus touch: chunks =>', output?.chunks?.length, output?.chunks?.slice(0, 2));
        console.log('ninja focus touch: text =>', output?.text);

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
// ninja focus touch >