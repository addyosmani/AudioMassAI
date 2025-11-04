import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.1/dist/transformers.min.js';

env.allowLocalModels = false;

class PipelineSingleton {
    static task = 'summarization';
    // ninja focus touch <
    static model = 'Xenova/bart-large-cnn';
    // ninja focus touch >
    static instance = null;

    static async getInstance(progress_callback = null) {
        if (this.instance === null) {
            this.instance = pipeline(this.task, this.model, { progress_callback });
        }
        return this.instance;
    }
}

self.addEventListener('message', async event => {
    const { text } = event.data;

    if (!text || typeof text !== 'string') {
        self.postMessage({
            status: 'error',
            message: 'No text data received or invalid format.',
        });
        return;
    }

    try {
        const summarizer = await PipelineSingleton.getInstance(modelState => {
            self.postMessage(modelState);
        });

        const output = await summarizer(text, {
            max_length: 150,
            min_length: 40
        });

        const summary = output[0].summary_text.trim();

        self.postMessage({
            status: 'complete',
            summary
        });
    } catch (error) {
        console.error('Summarization error:', error);
        self.postMessage({
            status: 'error',
            message: error.message,
        });
    }
});