document.addEventListener('DOMContentLoaded', () => {
    // Initialize Socket.io Connection
    const socket = io();

    // Trigger model download when socket connects/reconnects
    socket.on('connect', () => {
        socket.emit('trigger-model-download');
        console.log("Emitted event 'trigger-model-download'")
    });

    // UI Elements
    const generateBtn = document.getElementById('generate-btn');

    // State: selectedRatio is null initially (enforcing explict selection)
    let selectedRadio = null;
    let activeGenerating = false;
    let modelLoaded = false;

    // Listen to Model Download Progress event (Socket Placeholder)
    socket.on('model-download-progress', (data) => {
        console.log("Listening 'model-download-progress' event", data);

        const { percent = 0, status = '', size = '' } = data;

        const container = document.getElementById('model-download-container');
        const percentEl = document.getElementById('model-download-percent');
        const barEl = document.getElementById("model-download-bar");
        const statusEl = document.getElementById("model-download-status");
        const sizeEl = document.getElementById('model-size-label');
        const btnIcon = document.getElementById("generate-btn-icon");
        const btnText = document.getElementById("generate-btn-text");

        if (percentEl) percentEl.textContent = `${percent}%`;
        if (barEl) barEl.style.width = `${percent}%`;
        if (statusEl) statusEl.textContent = status;
        if (sizeEl && size) sizeEl.textContent = `(${size})`;

        if (percent < 100) {
            modelLoaded = false;
            if (!activeGenerating) {
                generateBtn.disabled = true;
                if (btnIcon) btnIcon.className = 'fa-solid fa-download animate-bounce'
                if (btnText) btnText.textContent = `Downloading Model (${percent}%)...`;
            }
        } else {
            modelLoaded = true;
            if (!activeGenerating) {
                generateBtn.disabled = false;
                if (btnIcon) btnIcon.className = 'fa-solid fa-wand-magic-sparkles mr-2'
                if (btnText) btnText.textContent = 'Generate';
            }
            setTimeout(() => {
                if (statusEl) statusEl.textContent = 'Model loaded and ready locally.';
                const icon = container ? container.querySelector('i') : null;
                if (icon) {
                    icon.className = 'fa-solid fa-circle-check text-green-500';
                }
            }, 500)
        }
    })
})