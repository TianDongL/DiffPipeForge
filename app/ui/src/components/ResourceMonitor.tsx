import { useEffect, useState } from 'react';
import { GlassCard } from './ui/GlassCard';
import { Cpu, Database, Zap, HardDrive } from 'lucide-react';
import { useTranslation } from 'react-i18next';

interface GPUStats {
    id: number;
    name: string;
    gpu_util: number;
    mem_total: number;
    mem_used: number;
    mem_free: number;
    temperature: number;
}

interface DiskStats {
    device: string;
    mountpoint: string;
    total: number;
    used: number;
    free: number;
    percent: number;
}

interface SystemStats {
    cpu_model?: string;
    cpu_percent: number;
    memory: {
        total: number;
        available: number;
        percent: number;
        used: number;
    };
    disks?: DiskStats[];
    gpus: GPUStats[];
    timestamp: number;
}

export function ResourceMonitor() {
    const { t } = useTranslation();
    const [stats, setStats] = useState<SystemStats | null>(null);
    const [cpuModel, setCpuModel] = useState<string>("");

    useEffect(() => {
        // Start monitor (no-op if already running in backend)
        // @ts-ignore
        window.ipcRenderer.invoke('start-resource-monitor');

        // Initial sync of stats if monitor was already running
        // @ts-ignore
        window.ipcRenderer.invoke('get-resource-monitor-stats').then(initialStats => {
            if (initialStats) {
                setStats(initialStats);
                if (initialStats.cpu_model) setCpuModel(initialStats.cpu_model);
            }
        });

        const handleStats = (_event: any, data: SystemStats) => {
            // @ts-ignore
            if (data.error) return;
            if (data.cpu_model) setCpuModel(data.cpu_model);

            setStats(prev => {
                let diskData = data.disks;
                if (!diskData || diskData.length === 0) {
                    diskData = prev?.disks || [];
                }
                if (diskData.length > 0) {
                    diskData = [...diskData].sort((a, b) => a.mountpoint.localeCompare(b.mountpoint));
                }
                return { ...data, disks: diskData };
            });
        };

        // @ts-ignore
        window.ipcRenderer.on('resource-stats', handleStats);

        return () => {
            // DON'T stop monitor on unmount to keep it running in background
            // @ts-ignore
            window.ipcRenderer.off('resource-stats', handleStats);
        };
    }, []);

    const formatBytes = (bytes: number) => {
        const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
        if (bytes === 0) return '0 B';
        const i = Math.floor(Math.log(bytes) / Math.log(1024));
        return parseFloat((bytes / Math.pow(1024, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const getColor = (percent: number) => {
        if (percent < 50) return 'bg-green-500';
        if (percent < 80) return 'bg-yellow-500';
        return 'bg-red-500';
    };

    if (!stats) {
        return (
            <div className="flex items-center justify-center h-64">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
                <span className="ml-3 text-muted-foreground">{t('monitor.initializing')}</span>
            </div>
        );
    }

    return (
        <div className="space-y-6 animate-in fade-in duration-500 max-w-4xl mx-auto">
            {/* Action Header */}
            <header className="mb-8">
                <h2 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-purple-600 dark:from-indigo-400 dark:to-purple-400 text-shadow-glow">
                    {t('nav.resource_monitor')}
                </h2>
                <p className="text-muted-foreground mt-1">
                    {t('monitor.resource_desc') || 'Real-time monitoring of CPU, RAM, and GPU usage.'}
                </p>
            </header>
            {/* CPU Card */}
            <GlassCard className="p-6 relative overflow-hidden group hover:bg-white/5 transition-colors">
                <div className="flex items-center gap-6">
                    <div className="p-4 rounded-xl bg-blue-500/10 text-blue-500 shrink-0">
                        <Cpu size={32} />
                    </div>
                    <div className="flex-1">
                        <div className="flex justify-between items-start mb-2">
                            <div>
                                <h3 className="text-lg font-semibold">CPU: {cpuModel || stats.cpu_model || "Unknown"}</h3>
                                <p className="text-sm text-muted-foreground">{t('monitor.cpu_usage')}</p>
                            </div>
                            <h3 className="text-2xl font-bold font-mono">{stats.cpu_percent.toFixed(1)}%</h3>
                        </div>
                        <div className="h-3 bg-secondary/50 rounded-full overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all duration-500 ${getColor(stats.cpu_percent)}`}
                                style={{ width: `${stats.cpu_percent}%` }}
                            />
                        </div>
                    </div>
                </div>
            </GlassCard>

            {/* RAM Card */}
            <GlassCard className="p-6 relative overflow-hidden group hover:bg-white/5 transition-colors">
                <div className="flex items-center gap-6">
                    <div className="p-4 rounded-xl bg-purple-500/10 text-purple-500 shrink-0">
                        <Database size={32} />
                    </div>
                    <div className="flex-1">
                        <div className="flex justify-between items-start mb-2">
                            <div>
                                <h3 className="text-lg font-semibold">{t('monitor.system_memory')}</h3>
                                <p className="text-sm text-muted-foreground">
                                    {formatBytes(stats.memory.used)} / {formatBytes(stats.memory.total)}
                                </p>
                            </div>
                            <h3 className="text-2xl font-bold font-mono">{stats.memory.percent.toFixed(1)}%</h3>
                        </div>
                        <div className="h-3 bg-secondary/50 rounded-full overflow-hidden">
                            <div
                                className={`h-full rounded-full transition-all duration-500 ${getColor(stats.memory.percent)}`}
                                style={{ width: `${stats.memory.percent}%` }}
                            />
                        </div>
                    </div>
                </div>
            </GlassCard>

            {/* GPU Cards */}
            {stats.gpus.map((gpu) => (
                <GlassCard key={gpu.id} className="p-6 relative overflow-hidden group hover:bg-white/5 transition-colors">
                    <div className="flex items-center gap-6">
                        <div className="p-4 rounded-xl bg-yellow-500/10 text-yellow-500 shrink-0">
                            <Zap size={32} />
                        </div>
                        <div className="flex-1 space-y-4">
                            {/* Header */}
                            <div className="flex justify-between items-start mb-2">
                                <div>
                                    <h3 className="text-lg font-semibold flex items-center gap-2">
                                        <span className="px-1.5 py-0.5 rounded text-xs bg-primary/10 text-primary border border-primary/20">GPU {gpu.id}</span>
                                        {gpu.name}
                                    </h3>
                                </div>
                                <h3 className="text-2xl font-bold font-mono">{gpu.temperature}°C</h3>
                            </div>

                            {/* Core Load */}
                            <div>
                                <div className="flex justify-between text-sm mb-1">
                                    <span className="text-muted-foreground">{t('monitor.gpu_core')}</span>
                                    <span className="font-medium font-mono">{gpu.gpu_util}%</span>
                                </div>
                                <div className="h-2 bg-secondary/50 rounded-full overflow-hidden">
                                    <div
                                        className={`h-full rounded-full transition-all duration-500 ${getColor(gpu.gpu_util)}`}
                                        style={{ width: `${gpu.gpu_util}%` }}
                                    />
                                </div>
                            </div>

                            {/* VRAM Usage */}
                            <div>
                                <div className="flex justify-between text-sm mb-1">
                                    <span className="text-muted-foreground">{t('monitor.gpu_memory')}</span>
                                    <span className="font-medium font-mono">
                                        {formatBytes(gpu.mem_used)} / {formatBytes(gpu.mem_total)}
                                    </span>
                                </div>
                                <div className="h-2 bg-secondary/50 rounded-full overflow-hidden">
                                    <div
                                        className={`h-full rounded-full transition-all duration-500 ${getColor((gpu.mem_used / gpu.mem_total) * 100)}`}
                                        style={{ width: `${(gpu.mem_used / gpu.mem_total) * 100}%` }}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                </GlassCard>
            ))}

            {/* Disk Cards */}
            {stats.disks && stats.disks.length > 0 && (
                <div className="space-y-4">
                    {stats.disks.map((disk) => (
                        <GlassCard key={disk.mountpoint} className="p-6 relative overflow-hidden group hover:bg-white/5 transition-colors shadow-sm">
                            <div className="flex items-center gap-6">
                                <div className="p-4 rounded-xl bg-orange-500/10 text-orange-500 shrink-0">
                                    <HardDrive size={32} />
                                </div>
                                <div className="flex-1">
                                    <div className="flex justify-between items-start mb-2">
                                        <div>
                                            <h3 className="text-lg font-semibold">
                                                {disk.mountpoint}
                                            </h3>
                                            <p className="text-sm text-muted-foreground uppercase tracking-wider">
                                                {formatBytes(disk.used)} / {formatBytes(disk.total)}
                                            </p>
                                        </div>
                                        <h3 className="text-2xl font-bold font-mono">{disk.percent.toFixed(1)}%</h3>
                                    </div>
                                    <div className="h-3 bg-secondary/50 rounded-full overflow-hidden">
                                        <div
                                            className={`h-full rounded-full transition-all duration-500 ${getColor(disk.percent)}`}
                                            style={{ width: `${disk.percent}%` }}
                                        />
                                    </div>
                                </div>
                            </div>
                        </GlassCard>
                    ))}
                </div>
            )}

            {stats.gpus.length === 0 && (
                <div className="text-center p-8 border-2 border-dashed rounded-xl border-muted/20">
                    <p className="text-muted-foreground">{t('monitor.no_gpu')}</p>
                </div>
            )}
        </div>
    );
}
