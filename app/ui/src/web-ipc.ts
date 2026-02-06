
// Web IPC Bridge for Cloud/Browser Mode
// Polyfills window.ipcRenderer if it's missing (e.g. in standard browser)

const initializeWebIPC = () => {
    // @ts-ignore
    if (window.ipcRenderer) {
        console.log('[WebIPC] window.ipcRenderer already exists. Skipping polyfill.');
        return;
    }

    // Force enable if VITE_WEB_ONLY or simply if we are in a browser environment without electron
    const shouldEnable =
        import.meta.env.VITE_WEB_ONLY === '1' ||
        import.meta.env.VITE_WEB_ONLY === 'true' ||
        import.meta.env.MODE === 'cloud' ||
        !window.navigator.userAgent.includes('Electron'); // Fallback check

    if (!shouldEnable) return;

    console.log('[WebIPC] Initializing Web IPC Bridge for Cloud/Browser Mode...');

    const API_URL = '/ipc';
    const listeners: Record<string, Function[]> = {};
    const pollingIntervals: Record<string, any> = {};

    // Helper to start polling for specific channels that expect push events
    const startPolling = (channel: string) => {
        if (pollingIntervals[channel]) return;

        if (channel === 'resource-stats') {
            pollingIntervals[channel] = setInterval(async () => {
                try {
                    const response = await fetch(`${API_URL}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ channel: 'get-resource-monitor-stats', args: [] })
                    });
                    if (response.ok) {
                        const data = await response.json();
                        // Verify if data is valid before emitting
                        if (data && !data.error) {
                            emit(channel, {}, data);
                        }
                    }
                } catch (e) {
                    console.error('[WebIPC] Polling resource-stats error:', e);
                }
            }, 2000); // Poll every 2s
        }
        else if (channel === 'training-status') {
            pollingIntervals[channel] = setInterval(async () => {
                try {
                    const response = await fetch(`${API_URL}`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ channel: 'get-training-status', args: [] })
                    });
                    if (response.ok) {
                        const data = await response.json();
                        // Training status usually mimics the event structure
                        emit(channel, {}, data);
                    }
                } catch (e) {
                    console.error('[WebIPC] Polling training-status error:', e);
                }
            }, 3000);
        }
    };

    const stopPolling = (channel: string) => {
        // Only stop if no listeners left? For now simple implementation
        if (pollingIntervals[channel]) {
            // Check if any listeners remain for this channel
            if (!listeners[channel] || listeners[channel].length === 0) {
                clearInterval(pollingIntervals[channel]);
                delete pollingIntervals[channel];
            }
        }
    };

    const emit = (channel: string, event: any, ...args: any[]) => {
        if (listeners[channel]) {
            listeners[channel].forEach(fn => fn(event, ...args));
        }
    };

    // Mock ipcRenderer
    const mockIpcRenderer = {
        invoke: async (channel: string, ...args: any[]) => {
            // console.log(`[WebIPC] Invoke: ${channel}`, args);

            try {
                const response = await fetch(API_URL, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        channel,
                        args
                    })
                });

                if (!response.ok) {
                    throw new Error(`HTTP error! status: ${response.status}`);
                }

                const result = await response.json();
                return result;
            } catch (error) {
                console.error(`[WebIPC] Error invoking ${channel}:`, error);
                // Return error object instead of crashing if possible, or rethrow
                return { error: (error as Error).message };
            }
        },

        on: (channel: string, func: Function) => {
            console.log(`[WebIPC] Listener added for: ${channel}`);
            if (!listeners[channel]) listeners[channel] = [];
            listeners[channel].push(func);

            // Start polling if it's a known push channel
            startPolling(channel);
        },

        removeListener: (channel: string, func: Function) => {
            console.log(`[WebIPC] Listener removed for: ${channel}`);
            if (listeners[channel]) {
                listeners[channel] = listeners[channel].filter(f => f !== func);
                stopPolling(channel);
            }
        },

        send: (channel: string, ...args: any[]) => {
            console.log(`[WebIPC] Send: ${channel}`, args);
        }
    };

    // Inject into window
    // @ts-ignore
    window.ipcRenderer = mockIpcRenderer;
    console.log('[WebIPC] window.ipcRenderer injected successfully.');
};

initializeWebIPC();
