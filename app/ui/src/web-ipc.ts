
// Web IPC Bridge for Cloud/Browser Mode
// Polyfills window.ipcRenderer if VITE_WEB_ONLY is set

// @ts-ignore
if (import.meta.env.VITE_WEB_ONLY === '1' || import.meta.env.VITE_WEB_ONLY === 'true' || import.meta.env.MODE === 'cloud') {
    console.log('[WebIPC] Initializing Web IPC Bridge for Cloud Mode...');

    const API_URL = '/ipc'; // Relative path, handled by Vite proxy or Nginx

    // Mock ipcRenderer implementation
    const mockIpcRenderer = {
        invoke: async (channel: string, ...args: any[]) => {
            console.log(`[WebIPC] Invoke: ${channel}`, args);

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
                throw error;
            }
        },

        // Basic event stubbing
        on: (channel: string, func: Function) => {
            console.log(`[WebIPC] Listener added for: ${channel}`);
            // Return a no-op disposer to prevent crashes in components that expect one
            return () => {
                console.log(`[WebIPC] Listener removed (disposed) for: ${channel}`);
            };
        },

        removeListener: (channel: string, func: Function) => {
            console.log(`[WebIPC] Listener removed for: ${channel}`);
        },

        send: (channel: string, ...args: any[]) => {
            console.log(`[WebIPC] Send: ${channel}`, args);
        }
    };

    // Inject into window
    // @ts-ignore
    window.ipcRenderer = mockIpcRenderer;
    console.log('[WebIPC] window.ipcRenderer injected.');
}
