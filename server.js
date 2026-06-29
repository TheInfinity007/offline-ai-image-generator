import express from 'express'
import path from 'path'
import http from 'http'
import { Server } from 'socket.io'
import fs from 'fs';
import { fileURLToPath } from 'url';

import { loadModel, unloadModel, getLoadedModelInfo, diffusion, SDXL_BASE_1_0_3B_Q8_0 } from '@qvac/sdk'

import { EVENT, DIFFUSION } from './src/constants.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const CONFIG_PATH = path.join(__dirname, '.device-preference.json');

const getPreferredDevice = () => {
    try {
        if (fs.existsSync(CONFIG_PATH)) {
            const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
            return data.device || null;
        }
    } catch (err) {
        console.error('Failed to read device preferences:', err.message);
    }
    return null;
}

const setPreferredDevice = (device) => {
    try {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify({ device }), 'utf-8')
    } catch (err) {
        console.error('Failed to write device preference:', err.message);
    }
}

// Global model state
let loadedModelId = process.modelId || null;
let modelLoadPercent = 0;
let modelLoadStatus = 'Awaiting trigger...';
let isModelLoading = false;

const model = SDXL_BASE_1_0_3B_Q8_0;
const modelSize = (model.expectedSize / (1024 * 1024 * 1024)).toFixed(2) + ' GB';

const broadcastModelProgress = (percent, status) => {
    io.emit(EVENT.MODEL_DOWNLOAD_PROGRESS, { percent, status, size: modelSize })
}

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    })

    // Trigger model download
    socket.on(EVENT.TRIGGER_MODEL_DOWNLOAD, async () => {

        console.log("Event listened", EVENT.TRIGGER_MODEL_DOWNLOAD)

        // If already loaded, verify it's still alive in the worker
        if (loadedModelId) {
            try {
                console.log("Calling getLoadedModelInfo")
                await getLoadedModelInfo({ modelId: loadedModelId });
                socket.emit(EVENT.MODEL_DOWNLOAD_PROGRESS, {
                    percent: 100,
                    status: 'Model fully loaded locally.',
                    size: modelSize
                });
                console.log("Model already loaded");
                return;
            } catch (err) {
                console.log('Model ID was stale/not found, resetting state and reloading...', err.message);
                loadedModelId = null;
                process.modelId = null;
            }
        } else {
            console.log('No loadedModelId present')
        }

        // If currently loading, report current progress
        if (isModelLoading) {
            console.log('Model is currently loading, emitting the event model-download-progress')
            socket.emit(EVENT.MODEL_DOWNLOAD_PROGRESS, {
                percent: Math.round(modelLoadPercent),
                status: modelLoadStatus,
                size: modelSize
            })
            return;
        }

        isModelLoading = true;
        modelLoadPercent = 0;
        modelLoadStatus = 'Initiating model download...';
        broadcastModelProgress(modelLoadPercent, modelLoadStatus)

        try {
            console.log('Starting model download...');
            const preferredDevice = getPreferredDevice();
            const loadConfig = { prediction: "v" };
            if (preferredDevice) {
                loadConfig.device = preferredDevice;
                if (preferredDevice === "cpu") {
                    loadConfig.threads = 4;
                }
                console.log(`Using cached device preference: ${preferredDevice}`);
            }

            loadedModelId = await loadModel({
                modelSrc: model,
                modelType: 'sdcpp-generation',
                modelConfig: loadConfig,
                onProgress: (p) => {
                    modelLoadPercent = p.percentage;
                    modelLoadStatus = p.percentage >= 100 ? 'Model fully loaded locally.' : `Downloading model weights... (${p.percentage.toFixed(1)}%)`
                    broadcastModelProgress(Math.round(modelLoadPercent), modelLoadStatus)
                }
            });
            process.modelId = loadedModelId;
            isModelLoading = false;
            console.log("Model loaded successfully. ID:", loadedModelId);
        } catch (err) {
            isModelLoading = false;
            modelLoadPercent = 0;
            modelLoadStatus = 'Failed to load model: ' + err.message;
            console.error('Failed to load model:', err);
            broadcastModelProgress(modelLoadPercent, modelLoadStatus);
            socket.emit(EVENT.ERROR_EVENT, { message: 'Failed to load model: ' + err.message });
        }

    });


    socket.on(EVENT.GENERATE, async (data) => {
        console.log(`Receive event ${EVENT.GENERATE}`)
        const { prompt, ratio } = data;

        if (!prompt || prompt.trim() === '') {
            socket.emit('error_event', { message: 'Prompt is required' });
            return;
        }

        if (!loadedModelId) {
            socket.emit(EVENT.ERROR_EVENT, { message: 'Model is not loaded yet' });
            return;
        }

        const runDiffusion = async (modelIdToUse) => {
            socket.emit('progress', {
                percent: 0,
                status: 'Starting diffusion process...',
                sub: "DIFFUSION INITITALIZING"
            });

            console.log(`Generating image for prompt: "${prompt}" with ratio: ${ratio} using model ID: ${modelIdToUse}`);

            const { progressStream, outputs, stats } = diffusion({
                modelId: modelIdToUse,
                prompt,
                steps: DIFFUSION.STEPS,
                guidanceScale: DIFFUSION.GUIDANCE_SCALE
            });

            // Stream progress steps
            for await (const { step, totalSteps } of progressStream) {
                const percent = Math.round((step / totalSteps) * 100);
                socket.emit(EVENT.PROGRESS, {
                    percent,
                    status: `Denoising step ${step}/${totalSteps}...`,
                    sub: 'RUNNING DIFFUSION'
                });
            }

            // Resolve output buffers
            const buffers = await outputs;
            if (!buffers || !buffers.length) {
                throw new Error('No image buffer returned from diffusion model.');
            }

            // Convert image buffer to a base64 Data URL instead of saving to disk
            const base64Data = Buffer.from(buffers[0]).toString('base64');
            const dataUrl = `data:image/png;base64,${base64Data}`;

            // Emit success
            socket.emit(EVENT.SUCCESS, {
                url: dataUrl,
                prompt,
                seed: (await stats).seed || -1
            });

            console.log(`Image generated and emitted successfully as base64 Data URL.`);
        }

        try {
            await runDiffusion(loadedModelId);
        } catch (err) {
            console.error('Image generation failed:', err);

            const isCrash = err.code === 50205 || (err.message.includes('WORKER_CRASHED'));

            if (isCrash) {
                console.log('Worker crashed during GPU execution.');
                socket.emit('error_event', { message: 'Image generation failed due to worker crash: ' + err.message });
            } else {
                if (err.message.includes('MODEL_NOT_FOUND') || err.message.includes('not found')) {
                    loadedModelId = null;
                    process.modelId = null;
                    broadcastModelProgress(0, 'Model state lost. Please re-trigger download.');
                }
                socket.emit('error_event', { message: 'Image generation failed: ' + err.message });
            }
        }
    })
});

// Serve index.html for non-asset routes (Express 5-compatible catch-all)
app.get(/.*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

server.listen(PORT, () => {
    console.log(`Server is running at http://localhost:${PORT}`);
})

// Clean exit handler to unload the model when the server terminates
const handleCleanup = async (signal) => {
    console.log("Received signal:", signal);


    // await new Promise(resolve => server.close(resolve));

    const modelId = process.modelId || loadedModelId;

    console.log(`Handle cleanUp called, modelId`, modelId);

    if (modelId && modelId !== 'mock-model-id') {
        console.log(`\nUnloading model ID ${modelId} before closing server...`);
        try {
            await unloadModel({ modelId, clearStorage: true });
            console.log('Model unloaded successfully.');
        } catch (err) {
            console.log("ErrName: " + err.name)
            if (err.name === 'MODEL_NOT_LOADED' || (err.message && err.message.includes('not loaded'))) {
                console.log('Model was already unloaded.');
            } else {
                console.error('Failed to unload model during shutdown:', err);
            }
        }
    }
    console.log('Exiting')
    setTimeout(() => {
        console.log("Active Handles", process._getActiveHandles());
    }, 1000);
    process.exit(0);
}

// Register process exit listeners
// process.on('SIGINT', handleCleanup);
process.once('SIGINT', () => handleCleanup("SIGINT"));
process.on('SIGTERM', handleCleanup);