import express from 'express'
import path from 'path'
import http from 'http'
import { Server } from 'socket.io'
import { fileURLToPath } from 'url';

import { loadModel, unloadModel, getLoadedModelInfo, diffusion, SD_V2_1_1B_Q8_0 } from '@qvac/sdk'

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);

    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
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
async function handleCleanup() {
    const modelId = process.modelId || loadedModelId;

    /*
    if (modelId && modelId !== 'mock-model-id') {
        console.log(`\nUnloading model ID ${modelId} before closing server...`);
        try {
            await unloadModel({ modelId, clearStorage: false });
            console.log('Model unloaded successfully.');
        } catch (err) {
            if (err.name === 'MODEL_NOT_LOADED' || (err.message && err.message.includes('not loaded'))) {
                console.log('Model was already unloaded.');
            } else {
                console.error('Failed to unload model during shutdown:', err);
            }
        }
    }

    */
    process.exit(0);
}

// Register process exit listeners
process.on('SIGINT', handleCleanup);
process.on('SIGTERM', handleCleanup);