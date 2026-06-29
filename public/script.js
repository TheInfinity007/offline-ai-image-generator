document.addEventListener('DOMContentLoaded', () => {
    // Initialize Socket.io Connection
    const socket = io();

    // Trigger model download when socket connects/reconnects
    socket.on('connect', () => {
        socket.emit('trigger-model-download');
        console.log("Emitted event 'trigger-model-download'")
    });

    // UI Elements
    const promptInput = document.getElementById('prompt-input');
    const sizeBtns = document.querySelectorAll('.size-btn');
    const generateBtn = document.getElementById('generate-btn');

    const canvasWrapper = document.getElementById('canvas-wrapper');
    const canvasPlaceholder = document.getElementById('canvas-placeholder');
    const canvasAspectHint = document.getElementById('canvas-aspect-hint');
    const canvasLoader = document.getElementById('canvas-loader');

    // State: selectedRatio is null initially (enforcing explict selection)
    let selectedRadio = null;
    let activeGenerating = false;
    let modelLoaded = false;

    // Preset Cards Selection Logic
    const presetCards = document.querySelectorAll('.preset-card');
    presetCards.forEach(card => {
        card.addEventListener('click', () => {
            if (activeGenerating) return;

            // If already active, deselect and clear prompt
            if (card.classList.contains('active-preset')) {
                card.classList.remove('active-preset');
                promptInput.value = '';
            } else {
                // Remove active class from all other cards
                presetCards.forEach(c => c.classList.remove('active-preset'));
                // Make this card active
                card.classList.add('active-preset');
                // Populate prompt input
                promptInput.value = card.getAttribute('data-prompt');
                // Clear validation styles
                promptInput.classList.remove('border-destructive');
            }
        });
    });

    // Listen to Error Event
    socket.on('error_event', (data) => {
        const { message = '' } = data;
        alert(message)
        resetToInitialState();
    })

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

    const resetButtonState = () => {
        activeGenerating = false;
        if (modelLoaded) {
            generateBtn.disabled = false;
            generateBtn.innerHTML = '<i id="generate-btn-icon" class="fa-solid fa-wand-magic-sparkles mr-2"></i><span id="generate-btn-text">Generate</span>';
        } else {
            generateBtn.disabled = true;
            generateBtn.innerHTML = '<i id="generate-btn-icon" class="fa-solid fa-download animate-bounce mr-2"></i><span id="generate-btn-text">Downloading Model...</span>';
        }
    }

    const resetToInitialState = () => {
        resetButtonState();
        canvasLoader.classList.add('hidden');
        canvasPlaceholder.classList.remove('hidden');

        // Clear size selection to enforce it again
        selectedRadio = null;
        sizeBtns.forEach(button => {
            button.classList.remove('border-primary', 'bg-primary/10', 'text-white');
            button.classList.add('border-border', 'bg-secondary/40', 'text-neutral-400')
        });

        canvasWrapper.style.width = '400px';
        canvasWrapper.style.height = '400px';
        canvasAspectHint.textContent = 'Select a size above...';

        // Clear presets active state
        presetCards.forEach(c => c.classList.remove('active-preset'));
    }
})