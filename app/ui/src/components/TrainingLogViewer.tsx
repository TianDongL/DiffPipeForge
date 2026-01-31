import { useState, useEffect, useRef } from 'react';
import { GlassCard } from './ui/GlassCard';
import { Terminal, XCircle, ScrollText, Download, Square } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { cn } from '@/lib/utils';
import { GlassButton } from './ui/GlassButton';
import { GlassSelect } from './ui/GlassSelect';
import { useGlassToast } from './ui/GlassToast';

interface Session {
    id: string;
    path: string;
    timestamp: number;
    hasLog: boolean;
}

interface SpeedData {
    samplesPerSec: number;
    iterTime: number;
}

interface TrainingLogViewerProps {
    projectPath?: string | null;
    showTitle?: boolean;
    integrated?: boolean;
}

export function TrainingLogViewer({ projectPath, showTitle = true, integrated = false }: TrainingLogViewerProps) {
    const { t } = useTranslation();
    const { showToast } = useGlassToast();
    const [logs, setLogs] = useState<string[]>([]);
    const [isTraining, setIsTraining] = useState(false);
    const [sessions, setSessions] = useState<Session[]>([]);
    const [selectedSessionId, setSelectedSessionId] = useState<string | null>('current');
    const [speed, setSpeed] = useState<SpeedData | null>(null);
    const logEndRef = useRef<HTMLDivElement>(null);
    const isFirstLoad = useRef(true);

    const fetchSessions = async () => {
        if (!projectPath) return;
        const configPath = `${projectPath}/trainconfig.toml`;
        try {
            const res = await window.ipcRenderer.invoke('get-training-sessions', configPath);
            setSessions(res);
        } catch (e) {
            console.error("Failed to fetch sessions:", e);
        }
    };

    const parseSpeedFromLogs = (logLines: string[]) => {
        if (!logLines || logLines.length === 0) return null;
        for (let i = logLines.length - 1; i >= 0; i--) {
            const match = logLines[i].match(/iter time \(s\):\s*([\d.]+)\s*samples\/sec:\s*([\d.]+)/);
            if (match) {
                return {
                    iterTime: parseFloat(match[1]),
                    samplesPerSec: parseFloat(match[2])
                };
            }
        }
        return null;
    };

    const loadSessionLogs = async (sessionId: string | null) => {
        if (!sessionId || sessionId === 'current') {
            const status = await window.ipcRenderer.invoke('get-training-status');
            setIsTraining(status.running);
            if (status.currentLogFilePath) {
                const res = await window.ipcRenderer.invoke('get-training-logs', status.currentLogFilePath);
                setLogs(res || []);
                setSpeed(parseSpeedFromLogs(res || []));
            } else if (status.logs) {
                setLogs(status.logs);
                setSpeed(parseSpeedFromLogs(status.logs));
            } else {
                setLogs([]);
                setSpeed(null);
            }
        } else {
            const session = sessions.find(s => s.id === sessionId);
            if (session) {
                const res = await window.ipcRenderer.invoke('get-training-logs', session.path);
                setLogs(res || []);
                setSpeed(parseSpeedFromLogs(res || []));
            }
        }
    };

    useEffect(() => {
        if (projectPath && isFirstLoad.current) {
            fetchSessions().then(() => {
                loadSessionLogs(selectedSessionId);
            });
            isFirstLoad.current = false;
        } else if (projectPath) {
            loadSessionLogs(selectedSessionId);
        }
    }, [selectedSessionId, projectPath]);

    useEffect(() => {
        if (!isFirstLoad.current) {
            const timer = setInterval(() => {
                if (!isTraining) fetchSessions();
            }, 30000);
            return () => clearInterval(timer);
        }
    }, [isTraining]);

    useEffect(() => {
        const handleLogs = (_event: any, newLog: string) => {
            if (selectedSessionId === 'current' || !selectedSessionId) {
                setLogs(prev => {
                    const newLogs = [...prev, newLog];
                    return newLogs.slice(-2000);
                });
            }
        };

        const handleSpeed = (_event: any, speedData: SpeedData) => {
            if (selectedSessionId === 'current' || !selectedSessionId) {
                setSpeed(speedData);
            }
        };

        const handleStatus = (_event: any, status: any) => {
            if (status.type === 'finished' || status.type === 'error') {
                setIsTraining(false);
                setSpeed(null);
                fetchSessions();
            } else if (status.type === 'started') {
                setIsTraining(true);
                setSpeed(null);
                setSelectedSessionId('current');
                setTimeout(() => fetchSessions(), 7000);
            }
        };

        window.ipcRenderer.on('training-output', handleLogs);
        window.ipcRenderer.on('training-status', handleStatus);
        window.ipcRenderer.on('training-speed', handleSpeed);

        return () => {
            window.ipcRenderer.off('training-output', handleLogs);
            window.ipcRenderer.off('training-status', handleStatus);
            window.ipcRenderer.off('training-speed', handleSpeed);
        };
    }, [selectedSessionId]);

    const handleStopTraining = async () => {
        try {
            const res = await window.ipcRenderer.invoke('stop-training');
            if (res.success) {
                setIsTraining(false);
                setSpeed(null);
                showToast(t('training.training_stopped'), 'success');
            } else {
                showToast(t('training.failed_stop'), 'error');
            }
        } catch (e) {
            console.error("Failed to stop training:", e);
        }
    };

    useEffect(() => {
        if (isTraining) {
            logEndRef.current?.scrollIntoView({ behavior: 'smooth' });
        }
    }, [logs, isTraining]);

    const downloadLogs = () => {
        const content = logs.join('\n');
        const blob = new Blob([content], { type: 'text/plain' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const name = selectedSessionId || 'current';
        a.download = `training_log_${name}.log`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const sessionOptions = [
        { label: `● ${t('training_log.current_session')}`, value: 'current' },
        ...sessions.map(s => ({
            label: `${s.id} (${new Date(s.timestamp).toLocaleString()})`,
            value: s.id
        }))
    ];

    return (
        <div className={cn("flex flex-col gap-4", integrated ? "mt-8" : "h-full max-h-[calc(100vh-120px)]")}>
            <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-6 flex-wrap">
                    {showTitle && (
                        <h2 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-purple-600 dark:from-indigo-400 dark:to-purple-400 text-shadow-glow">
                            {t('nav.training_log')}
                        </h2>
                    )}
                    <p className="text-muted-foreground whitespace-nowrap text-xs">
                        {isTraining ? t('training_log.status_active') : t('training_log.status_inactive')}
                    </p>
                    <div className="flex items-center gap-2">
                        <GlassSelect
                            className="h-8 py-0 pl-2 text-xs min-w-[200px] bg-white/5 border-white/20"
                            options={sessionOptions}
                            value={selectedSessionId || 'current'}
                            onChange={(e) => setSelectedSessionId(e.target.value)}
                        />
                    </div>
                    {speed !== null && (
                        <div className="px-4 py-1.5 rounded-xl bg-indigo-500/10 text-indigo-100 border border-indigo-500/20 font-mono text-xs flex items-center gap-4 animate-in zoom-in duration-300 h-9 shadow-lg shadow-indigo-500/5">
                            <div className="flex items-center gap-2">
                                <Terminal size={13} className="text-indigo-400" />
                                <span className="opacity-80">{t('training_log.speed')}:</span>
                                <strong className="text-sm font-bold text-white tracking-tight">{speed.samplesPerSec.toFixed(3)}</strong>
                            </div>
                            <div className="w-[1px] h-4 bg-indigo-500/20" />
                            <div className="flex items-center gap-2">
                                <span className="opacity-80">{t('training_log.iter_time')}:</span>
                                <strong className="text-sm font-bold text-white tracking-tight">{speed.iterTime.toFixed(2)}s</strong>
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex gap-2">
                    {isTraining && (
                        <GlassButton
                            className="bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 text-white border-none shadow-lg"
                            size="sm"
                            onClick={handleStopTraining}
                        >
                            <Square className="w-3 h-3 mr-2" />
                            {t('training.stop')}
                        </GlassButton>
                    )}
                    <GlassButton
                        variant="outline"
                        size="sm"
                        onClick={downloadLogs}
                        disabled={logs.length === 0}
                        className="border-white/30 bg-white/5 hover:bg-white/10 hover:border-white/50 text-white/90"
                    >
                        <Download className="w-3 h-3 mr-2" />
                        {t('common.export')}
                    </GlassButton>
                    <GlassButton
                        variant="outline"
                        size="sm"
                        onClick={() => setLogs([])}
                        className="border-white/30 bg-white/5 hover:bg-white/10 hover:border-white/50 text-white/90"
                    >
                        <XCircle className="w-3 h-3 mr-2" />
                        {t('common.clear')}
                    </GlassButton>
                </div>
            </div>

            <GlassCard className={cn("flex-1 p-0 overflow-hidden flex flex-col border-primary/20 bg-black/40 backdrop-blur-xl min-h-[300px]", integrated && "max-h-[500px]")}>
                <div className="flex items-center justify-between px-4 py-2 bg-white/5 border-b border-white/10 text-[10px] font-mono opacity-70">
                    <div className="flex items-center gap-2">
                        <Terminal className="w-3 h-3" />
                        <span>
                            {selectedSessionId === 'current' || !selectedSessionId
                                ? `STDOUT_STREAM (${t('training_log.current_session')})`
                                : `STDOUT_STREAM - SESSION: ${selectedSessionId}`}
                        </span>
                    </div>
                    <div className="flex items-center gap-2">
                        <span className={cn("w-1.5 h-1.5 rounded-full", isTraining ? "bg-green-500 animate-pulse" : "bg-gray-500")} />
                        <span className="font-mono uppercase">{isTraining ? 'Live' : 'Idle'}</span>
                    </div>
                </div>

                <div className="flex-1 overflow-y-auto p-4 font-mono text-[12px] leading-relaxed scroll-smooth selection:bg-primary/30 custom-scrollbar">
                    {logs.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center opacity-30 gap-2 py-10">
                            <ScrollText className="w-8 h-8" />
                            <p className="italic text-sm">
                                {isTraining ? t('training_log.waiting') : t('training_log.no_logs')}
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-0.5">
                            {logs.map((log, idx) => (
                                <div key={idx} className={cn(
                                    "whitespace-pre-wrap break-all py-0.5 border-l-2 border-transparent hover:border-white/10 pl-2 transition-colors",
                                    log.toLowerCase().includes('error') || log.toLowerCase().includes('exception') || log.toLowerCase().includes('traceback') ? "text-red-400 bg-red-400/5" :
                                        log.toLowerCase().includes('warning') ? "text-amber-400 bg-amber-400/5" :
                                            log.includes('[Command]:') ? "text-violet-400 font-bold" :
                                                log.toLowerCase().includes('step') || log.toLowerCase().includes('info') ? "text-blue-300 font-bold" : "text-gray-300"
                                )}>
                                    <span className="inline-block w-6 text-white/20 select-none text-[9px]">{idx + 1}</span>
                                    {log}
                                </div>
                            ))}
                            <div ref={logEndRef} className="h-2" />
                        </div>
                    )}
                </div>
            </GlassCard>
        </div>
    );
}
