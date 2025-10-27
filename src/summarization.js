import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.1/dist/transformers.min.js';

// Skip local model check
env.allowLocalModels = false;

// Use the Singleton pattern to enable lazy construction of the pipeline
class PipelineSingleton {
    static task = 'summarization';
    static model = 'Xenova/t5-small';
    static instance = null;

    static async getInstance(progress_callback = null) {
        if (this.instance === null) {
            this.instance = pipeline(this.task, this.model, { progress_callback });
        }
        return this.instance;
    }
}

self.addEventListener('message', async (event) => {
    const { text } = event.data;

    if (!text || typeof text !== 'string') {
        self.postMessage({
            status: 'error',
            message: 'No text data received or invalid format.',
        });
        return;
    }

    try {
        // Get the pipeline instance
        const summarizer = await PipelineSingleton.getInstance((progress) => {
            self.postMessage(progress);
        });

        // Summarize the text
        const output = await summarizer(text, {
            max_length: 150,
            min_length: 40
        });

        const summary = output[0].summary_text.trim();

        // Send the summarization result back to the main thread
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