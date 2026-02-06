
// @ts-nocheck
/**
 * web-ipc.ts
 * 
 * This file provides a compatibility layer for "window.ipcRenderer" when running in a browser environment.
 * It strictly follows the Electron ipcRenderer.invoke() signature but forwards requests to the Python backend
 * running on port 5001 (proxied via Vite or direct).
 */

const isElectron = 'electron' in window || (navigator.userAgent.indexOf('Electron') >= 0);

if (!isElectron) {
    console.log('[WebIPC] Initializing Web Compatibility Layer for Cloud/Browser Mode');

    window.ipcRenderer = {
        /**
         * Simulation of ipcRenderer.invoke
         * @param channel The IPC channel name (e.g., 'create-new-project')
         * @param args Arguments passed to the handler
         */
        invoke: async (channel: string, ...args: any[]) => {
            console.log(`[WebIPC] Invoking: ${channel}`, args);

            try {
                // Construct the API URL
                // In dev: /ipc/channel (Vite proxy handles it)
                // In prod/cloud: We might need full URL if not proxied, but relative usually works if served from same origin
                // Assuming Vite proxy setup in vite.config.ts: '/ipc' -> 'http://127.0.0.1:5001'

                // Note: The python server exposes /ipc/{channel}
                // We send args as JSON body: { args: [...] }

                const response = await fetch(`/ipc/${channel}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({ args })
                });

                if (!response.ok) {
                    throw new Error(`Server returned ${response.status}: ${response.statusText}`);
                }

                const result = await response.json();
                return result;

            } catch (error) {
                console.error(`[WebIPC] Error invoking ${channel}:`, error);

                // Fallback behaviors for specific critical channels if server is down
                if (channel === 'get-recent-projects') return [];

                throw error;
            }
        },

        // Add other methods if needed (on, send, removeListener - mostly used for push updates)
        // For simple request-response, invoke is enough.
        // If the app uses .on(), we might need a polling mechanism or WebSocket.
        // For "New Project" / "Open", invoke is 99% of the Work.
        on: (channel: string, listener: any) => {
            console.warn(`[WebIPC] .on('${channel}') listener registered but pushed events are not fully supported in Web Mode yet.`);
            // TODO: Implement polling or WS if needed
            return window.ipcRenderer;
        },
        removeListener: (channel: string, listener: any) => {
            return window.ipcRenderer;
        },
        send: (channel: string, ...args: any[]) => {
            console.warn(`[WebIPC] .send('${channel}') called. One-way messages might not be handled.`);
        }
    };
}
