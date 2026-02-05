import { useState, useEffect } from 'react';
import AppLayout from './components/Layout';
import { ProjectSelectionPage } from './components/ProjectSelectionPage';
import { GlassToastProvider } from './components/ui/GlassToast';
import { WindowTitleBar } from './components/ui/WindowTitleBar';
import { useTranslation } from 'react-i18next';

// Web Fallback for Cloud/Browser mode
if (typeof window !== 'undefined' && !window.ipcRenderer) {
    (window as any).ipcRenderer = {
        invoke: async (channel: string, ...args: any[]) => {
            console.log(`[WebBridge] Invoking ${channel}`, args);
            try {
                const response = await fetch(`http://${window.location.hostname}:5001/ipc`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ channel, args })
                });
                return await response.json();
            } catch (e) {
                console.error(`[WebBridge] Failed to invoke ${channel}:`, e);
                return null;
            }
        },
        on: (channel: string, _callback: any) => {
            console.warn(`[WebBridge] 'on' is not fully supported in browser mode: ${channel}`);
        },
        send: (channel: string, ...args: any[]) => {
            console.log(`[WebBridge] Sending ${channel}`, args);
        }
    };
}

export default function App() {

    const [currentProject, setCurrentProject] = useState<string | null>(null);
    const { i18n } = useTranslation();

    useEffect(() => {
        // Load language
        const savedLang = window.ipcRenderer?.invoke('get-language');
        savedLang.then((lang: string) => {
            if (lang && lang !== i18n.language) {
                i18n.changeLanguage(lang);
            }
        });

        // Load and apply theme
        const savedTheme = window.ipcRenderer?.invoke('get-theme');
        savedTheme.then((theme: 'light' | 'dark') => {
            const currentTheme = theme || 'dark';
            document.documentElement.classList.remove('light', 'dark');
            document.documentElement.classList.add(currentTheme);
        });

        // Global drag-drop handlers to fix WSL2/Network path issues and 🚫 icon
        const handleGlobalDragOver = (e: DragEvent) => {
            e.preventDefault();
            if (e.dataTransfer) {
                e.dataTransfer.dropEffect = 'copy';
            }
        };
        const handleGlobalDrop = (e: DragEvent) => {
            // Prevent browser from opening files if dropped outside targets
            if (e.target === document.body || e.target === document.documentElement) {
                e.preventDefault();
            }
        };

        window.addEventListener('dragover', handleGlobalDragOver);
        window.addEventListener('drop', handleGlobalDrop);
        return () => {
            window.removeEventListener('dragover', handleGlobalDragOver);
            window.removeEventListener('drop', handleGlobalDrop);
        };
    }, [i18n]);

    const handleProjectSelect = (path: string) => {
        console.log("Selected project:", path);
        setCurrentProject(path);
    };

    const handleBackToHome = () => {
        // @ts-ignore
        window.ipcRenderer.invoke('set-session-folder', null);
        setCurrentProject(null);
    };

    return (
        <GlassToastProvider>
            <WindowTitleBar />
            <div className="flex-1 overflow-hidden relative flex flex-col">
                {currentProject ? (
                    <AppLayout
                        onBackToHome={handleBackToHome}
                        projectPath={currentProject}
                        onProjectRenamed={(newPath) => setCurrentProject(newPath)}
                    />
                ) : (
                    <ProjectSelectionPage onSelect={handleProjectSelect} />
                )}
            </div>
        </GlassToastProvider>
    );
}
