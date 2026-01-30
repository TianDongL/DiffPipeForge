import { useState, useEffect, useRef } from 'react';
import { GlassCard } from './ui/GlassCard';
import { GlassButton } from './ui/GlassButton';
import { GlassInput } from './ui/GlassInput';
import { useTranslation } from 'react-i18next';
import { Play, Square, ExternalLink, RefreshCw, Activity, FolderOpen } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useGlassToast } from './ui/GlassToast';

interface MonitorPageProps {
    className?: string;
    initialLogDir?: string;
    projectPath?: string | null;
}

export function MonitorPage({ className, initialLogDir, projectPath }: MonitorPageProps) {
    const { t } = useTranslation();
    const { showToast } = useGlassToast();

    // State for configuration
    const [host, setHost] = useState('localhost');
    const [port, setPort] = useState(6006);
    const [logDir, setLogDir] = useState('');

    // Remove the useEffect that auto-sets logDir
    // We now handle it as a fallback during start

    const [isRunning, setIsRunning] = useState(false);
    const [monitorUrl, setMonitorUrl] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [viewMode, setViewMode] = useState<'tensorboard' | 'wandb'>('tensorboard');

    // Reset logDir when project changes, to fallback to new project defaults
    useEffect(() => {
        setLogDir('');
    }, [projectPath, initialLogDir]);

    // Sync state on mount
    useEffect(() => {
        const syncStatus = async () => {
            setIsLoading(true);
            try {
                // @ts-ignore
                const status = await window.ipcRenderer.invoke('get-tensorboard-status');

                // Update settings fields
                if (status.settings) {
                    setHost(status.settings.host);
                    setPort(status.settings.port);
                    // Only sync if not already manually set
                    if (!logDir && status.settings.logDir) {
                        setLogDir(status.settings.logDir);
                    }
                }

                if (status.isRunning) {
                    setMonitorUrl(status.url);
                    setIsRunning(true);
                } else if (status.settings?.autoStart) {
                    // If it was supposed to be running but isn't (e.g. app restart), 
                    // we could auto-start here.
                    console.log("Auto-starting TensorBoard based on persistent settings...");
                    handleStart();
                }
            } catch (e) {
                console.error("Failed to sync TB status:", e);
            } finally {
                setIsLoading(false);
            }
        };
        syncStatus();
    }, []);

    // Start TensorBoard
    const handleStart = async () => {
        // Log dir priority:
        // 1. Manually entered logDir
        // 2. Current active project folder (projectPath) - prioritizes the session lock
        // 3. Fallback to config.output_dir (initialLogDir)
        let effectiveLogDir = (logDir || '').trim();

        if (!effectiveLogDir) {
            effectiveLogDir = (projectPath || '').trim() || (initialLogDir || '').trim();
        }

        if (!effectiveLogDir) {
            showToast(t('monitor.log_dir_placeholder'), 'error');
            return;
        }

        setIsLoading(true);
        try {
            // @ts-ignore
            const result = await window.ipcRenderer.invoke('start-tensorboard', {
                logDir: effectiveLogDir,
                host,
                port
            });

            if (result.success !== false) { // Assuming result can be { success: true, url } or just string? 
                // logic in main.ts returns { success: true, url } or throws. 
                // The resolve in main.ts is: resolve({ success: true, url: ... })
                setMonitorUrl(result.url);
                setIsRunning(true);
                showToast(t('monitor.started'), 'success');
            } else {
                throw new Error(result.error || "Failed to start");
            }
        } catch (e: any) {
            console.error("TB Start Error:", e);
            showToast(t('monitor.failed_start') + ": " + e.message, 'error');
        } finally {
            setIsLoading(false);
        }
    };

    const handleStop = async () => {
        setIsLoading(true);
        try {
            // @ts-ignore
            await window.ipcRenderer.invoke('stop-tensorboard');
            setIsRunning(false);
            setMonitorUrl('');
            showToast(t('monitor.stopped'), 'success');
        } catch (e: any) {
            console.error("TB Stop Error:", e);
            showToast(t('monitor.failed_stop') + ": " + e.message, 'error');
        } finally {
            setIsLoading(false);
        }
    };

    const handleOpenExternal = () => {
        if (monitorUrl) {
            window.open(monitorUrl, '_blank');
        }
    };

    const handlePickDir = async () => {
        try {
            // @ts-ignore
            const result = await window.ipcRenderer.invoke('dialog:openFile', {
                properties: ['openDirectory', 'createDirectory']
            });
            if (!result.canceled && result.filePaths.length > 0) {
                setLogDir(result.filePaths[0]);
            }
        } catch (e) {
            console.error("Failed to pick directory:", e);
        }
    };

    const iframeRef = useRef<HTMLIFrameElement>(null);

    const injectStyles = () => {
        const iframe = iframeRef.current;
        if (!iframe || !iframe.contentDocument) return;

        try {
            const style = iframe.contentDocument.createElement('style');
            style.textContent = `
                ::-webkit-scrollbar {
                  width: 6px;
                  height: 6px;
                }
                ::-webkit-scrollbar-track {
                  background: transparent;
                }
                ::-webkit-scrollbar-thumb {
                  background: rgba(156, 163, 175, 0.3);
                  border-radius: 10px;
                }
                ::-webkit-scrollbar-thumb:hover {
                  background: rgba(156, 163, 175, 0.5);
                }
                /* Dark mode support inside iframe if detectable, or just use a neutral semi-transparent style */
                @media (prefers-color-scheme: dark) {
                    ::-webkit-scrollbar-thumb {
                        background: rgba(255, 255, 255, 0.1);
                    }
                    ::-webkit-scrollbar-thumb:hover {
                        background: rgba(255, 255, 255, 0.2);
                    }
                }
                /* Force dark if the parent is dark (hacky but often works if we can set a class) */
                ${document.documentElement.classList.contains('dark') ? `
                    ::-webkit-scrollbar-thumb {
                        background: rgba(255, 255, 255, 0.1) !important;
                    }
                    ::-webkit-scrollbar-thumb:hover {
                        background: rgba(255, 255, 255, 0.2) !important;
                    }
                ` : ''}
            `;
            iframe.contentDocument.head.appendChild(style);
        } catch (e) {
            console.warn("Could not inject styles into TensorBoard iframe:", e);
        }
    };

    return (
        <div className={cn("space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500", className)}>
            {/* ... rest of the component ... */}
            <div className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-purple-600 dark:from-indigo-400 dark:to-purple-400 text-shadow-glow">
                        {t('nav.monitor')}
                    </h2>
                    <p className="text-muted-foreground mt-1">{t('monitor.desc')}</p>
                </div>
                <div className="flex items-center gap-2">
                    {isRunning && (
                        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-green-500/10 border border-green-500/20 text-green-600 dark:text-green-400 text-xs font-medium animate-pulse">
                            <Activity className="w-3.5 h-3.5" />
                            {t('monitor.running')}
                        </div>
                    )}
                </div>
            </div>

            <div className="flex w-full gap-4 mb-6">
                <button
                    onClick={() => setViewMode('tensorboard')}
                    className={cn(
                        "flex-1 py-3 text-sm font-bold rounded-xl transition-all duration-300 border",
                        viewMode === 'tensorboard'
                            ? "bg-green-500/10 border-green-500 text-green-600 dark:text-green-400 shadow-[0_0_20px_rgba(34,197,94,0.2)]"
                            : "bg-secondary/30 border-transparent text-muted-foreground hover:bg-secondary/50"
                    )}
                >
                    TensorBoard
                </button>
                <button
                    onClick={() => setViewMode('wandb')}
                    className={cn(
                        "flex-1 py-3 text-sm font-bold rounded-xl transition-all duration-300 border",
                        viewMode === 'wandb'
                            ? "bg-green-500/10 border-green-500 text-green-600 dark:text-green-400 shadow-[0_0_20px_rgba(34,197,94,0.2)]"
                            : "bg-secondary/30 border-transparent text-muted-foreground hover:bg-secondary/50"
                    )}
                >
                    Weights & Biases
                </button>
            </div>

            {viewMode === 'tensorboard' ? (
                <GlassCard className="p-6">
                    <div className="flex flex-col gap-6">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 items-end">
                            <GlassInput
                                label={t('monitor.host')}
                                value={host}
                                onChange={(e) => setHost(e.target.value)}
                                placeholder="localhost"
                                disabled={isRunning || isLoading}
                            />
                            <GlassInput
                                label={t('monitor.port')}
                                type="number"
                                value={port}
                                onChange={(e) => setPort(parseInt(e.target.value) || 6006)}
                                placeholder="6006"
                                disabled={isRunning || isLoading}
                            />
                            <div className="relative">
                                <GlassInput
                                    label={t('monitor.log_dir') + t('common.optional')}
                                    value={logDir}
                                    onChange={(e) => setLogDir(e.target.value)}
                                    placeholder={initialLogDir || projectPath || t('monitor.log_dir_placeholder')}
                                    disabled={isRunning || isLoading}
                                />
                                <button
                                    onClick={handlePickDir}
                                    disabled={isRunning || isLoading}
                                    className="absolute right-3 bottom-2.5 p-1 rounded-lg bg-white/5 hover:bg-white/10 text-muted-foreground transition-colors hover:text-primary disabled:opacity-50"
                                    title={t('project.open')}
                                >
                                    <FolderOpen className="w-4 h-4" />
                                </button>
                            </div>
                        </div>

                        <div className="flex flex-col md:flex-row items-center gap-4 w-full">
                            {!isRunning ? (
                                <GlassButton
                                    onClick={handleStart}
                                    disabled={isLoading}
                                    className="w-full bg-green-600 hover:bg-green-700 text-white shadow-lg shadow-green-900/20"
                                >
                                    {isLoading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Play className="w-4 h-4 mr-2" />}
                                    {t('monitor.start')}
                                </GlassButton>
                            ) : (
                                <>
                                    <GlassButton
                                        onClick={handleStop}
                                        disabled={isLoading}
                                        className="flex-1 w-full bg-red-600 hover:bg-red-700 text-white shadow-lg shadow-red-900/20"
                                    >
                                        {isLoading ? <RefreshCw className="w-4 h-4 mr-2 animate-spin" /> : <Square className="w-4 h-4 mr-2" />}
                                        {t('monitor.stop')}
                                    </GlassButton>
                                    <GlassButton
                                        onClick={handleOpenExternal}
                                        variant="outline"
                                        className="flex-1 w-full"
                                    >
                                        <ExternalLink className="w-4 h-4 mr-2" />
                                        {t('monitor.open_browser')}
                                    </GlassButton>
                                </>
                            )}
                        </div>
                    </div>
                </GlassCard>
            ) : (
                <GlassCard className="p-6">
                    <div className="text-center py-10">
                        <h3 className="text-xl font-bold mb-4">Weights & Biases</h3>
                        <p className="text-muted-foreground mb-6 max-w-lg mx-auto">
                            {t('monitor.wandb_hint_1')}
                            <br />
                            {t('monitor.wandb_hint_2')}
                        </p>
                        <GlassButton
                            onClick={() => window.open('https://wandb.ai/home', '_blank')}
                            className="bg-black text-white hover:bg-gray-800"
                        >
                            <ExternalLink className="w-4 h-4 mr-2" />
                            {t('monitor.open_wandb')}
                        </GlassButton>
                    </div>
                </GlassCard>
            )}

            {/* Monitor View Area for TensorBoard */}
            {viewMode === 'tensorboard' && isRunning && monitorUrl && (
                <div className="h-[600px] w-full rounded-xl overflow-hidden border border-gray-200 dark:border-white/10 shadow-lg bg-white dark:bg-black/40 relative group">
                    <iframe
                        ref={iframeRef}
                        src={monitorUrl}
                        className="w-full h-full"
                        title="TensorBoard Monitor"
                        onLoad={injectStyles}
                    />
                </div>
            )}

            {viewMode === 'tensorboard' && !isRunning && (
                <div className="h-[400px] w-full rounded-xl border-2 border-dashed border-gray-200 dark:border-white/10 flex flex-col items-center justify-center text-muted-foreground bg-black/5 dark:bg-white/5">
                    <Activity className="w-16 h-16 mb-4 opacity-20" />
                    <p>{t('monitor.not_running_hint')}</p>
                </div>
            )}
        </div>
    );
}
