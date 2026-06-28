document.addEventListener('DOMContentLoaded', () => {
    // Initialize Socket.io Connection
    const socket = io();

    // Trigger model download when socket connects/reconnects
    socket.on('connect', () => {
        socket.emit('trigger-model-download');
        console.log("Emitted event 'trigger-model-download'")
    });
})