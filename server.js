import express from 'express'
import path from 'path'
import http from 'http'
import { Server } from 'socket.io'
import fs from 'fs';
import { fileURLToPath } from 'url';

import { loadModel, unloadModel, getLoadedModelInfo, diffusion, SD_V2_1_1B_Q8_0 } from '@qvac/sdk'

import { EVENT } from './src/constants.js';

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

const modelSize = (SD_V2_1_1B_Q8_0.expectedSize / (1024 * 1024 * 1024)).toFixed(2) + ' GB';

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
                modelSrc: SD_V2_1_1B_Q8_0,
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


    const modelId = process.modelId || loadedModelId;

    console.log(`Handle cleanUp called, modelId`, modelId);

    if (modelId && modelId !== 'mock-model-id') {
        console.log(`\nUnloading model ID ${modelId} before closing server...`);
        try {
            await unloadModel({ modelId, clearStorage: false });
            console.log('Model unloaded successfully.');
        } catch (err) {
            console.log(`Error in unloading model, err:`, err.message);
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
process.on('SIGINT', handleCleanup);
process.on('SIGTERM', handleCleanup);