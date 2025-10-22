// ninja focus touch <
import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@xenova/transformers@2.17.1/dist/transformers.min.js';

// Skip local model check
env.allowLocalModels = false;

// Use the Singleton pattern to enable lazy construction of the pipeline
class PipelineSingleton {
    static task = 'text2text-generation';
    static model = 'Xenova/t5-small'; // Using T5-small for summarization
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
            self.postMessage({
                status: 'progress',
                progress: progress
            });
        });

        // Prepare text for T5 summarization
        // T5 expects a prefix for the task
        const inputText = `summarize: ${text}`;

        // Summarize the text
        const output = await summarizer(inputText, {
            max_length: 150,
            min_length: 30,
            length_penalty: 2.0,
            num_beams: 4,
            early_stopping: true,
            do_sample: false
        });

        // Extract the generated text from the result
        const summary = output[0].summary_text;

        // Send the summarization result back to the main thread
        self.postMessage({
            status: 'complete',
            summary: summary
        });
    } catch (error) {
        console.error('Summarization error:', error);
        self.postMessage({
            status: 'error',
            message: error.message,
        });
    }
});
// ninja focus touch >