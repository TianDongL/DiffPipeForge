import { useState, useEffect, useRef } from "react";
import { Sidebar } from "./Sidebar";
import { DatasetConfig } from './DatasetConfig';
import { ModelTrainingPage } from "./ModelTrainingPage";
import { MonitorPage } from './MonitorPage';
import { ResourceMonitor } from './ResourceMonitor';
import { TrainingLogPage } from './TrainingLogPage';
import { TrainingLauncherPage } from './TrainingLauncherPage';
import { GlassConfirmDialog } from "./ui/GlassConfirmDialog";
import { Home, CheckCircle2, UploadCloud, AlertTriangle, FolderOpen, ChevronDown } from 'lucide-react';
import { GlassButton } from "./ui/GlassButton";
import { useTranslation } from "react-i18next";
import { useGlassToast } from "./ui/GlassToast";
import { parse } from "smol-toml";

export type NavItem = 'dataset' | 'eval_dataset' | 'training_setup' | 'training_run' | 'monitor' | 'resource_monitor' | 'training_log';

// Garbage removed

interface AppLayoutProps {
    onBackToHome: () => void;
    projectPath?: string | null;
    onProjectRenamed?: (newPath: string) => void;
}

export default function AppLayout({ onBackToHome, projectPath, onProjectRenamed }: AppLayoutProps) {
    const { t } = useTranslation();
    const { showToast } = useGlassToast();
    const [activeTab, setActiveTab] = useState<NavItem>('dataset');
    const [theme, setTheme] = useState<'light' | 'dark'>('dark');
    const [isDragging, setIsDragging] = useState(false);
    const [importedConfig, setImportedConfig] = useState<any>(null);
    const [currentModelType, setCurrentModelType] = useState<string>('sdxl');
    const [currentModelVersion, setCurrentModelVersion] = useState<string>('');
    const [trainPath, setTrainPath] = useState('');
    const [evalPaths, setEvalPaths] = useState<string[]>([]);
    const [evalSets, setEvalSets] = useState<{ name: string, path: string }[]>([]);
    const [isPathConflictDialogOpen, setIsPathConflictDialogOpen] = useState(false);
    const [isRenaming, setIsRenaming] = useState(false);
    const [newName, setNewName] = useState('');
    const [isRenameConfirmOpen, setIsRenameConfirmOpen] = useState(false);
    const [pythonInfo, setPythonInfo] = useState<{ path: string, displayName: string, status: string, isInternal: boolean, availableEnvs: { name: string, path: string }[] }>({
        path: '',
        displayName: '',
        status: 'checking',
        isInternal: false,
        availableEnvs: []
    });
    const [isEnvDropdownOpen, setIsEnvDropdownOpen] = useState(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // Track loaded project to prevent double-loading in StrictMode
    const lastLoadedPathRef = useRef<string | null>(null);

    // Warning when any eval path matches training path
    useEffect(() => {
        const timer = setTimeout(() => {
            if (trainPath && evalPaths.length > 0) {
                const conflict = evalPaths.some(p => p && p.trim() !== '' && p.trim() === trainPath.trim());
                if (conflict) {
                    setIsPathConflictDialogOpen(true);
                }
            }
        }, 1000);
        return () => clearTimeout(timer);
    }, [trainPath, evalPaths]);

    // Theme toggle handler
    const toggleTheme = () => {
        const newTheme = theme === 'light' ? 'dark' : 'light';
        setTheme(newTheme);
        document.documentElement.classList.remove('light', 'dark');
        document.documentElement.classList.add(newTheme);
    };

    // Initialize theme
    useEffect(() => {
        document.documentElement.classList.add('dark');
    }, []);

    // Load project from path
    const loadProjectFromPath = async (folderPath: string) => {
        try {
            // @ts-ignore
            const result = await window.ipcRenderer.invoke('read-project-folder', folderPath);

            if (result.error) {
                showToast(result.error, 'error');
                return;
            }

            const parsedConfig: any = {};
            let loadedCount = 0;

            if (result.datasetConfig) {
                try {
                    parsedConfig.dataset = parse(result.datasetConfig);
                    loadedCount++;
                } catch (e) { console.error('Error parsing dataset.toml', e); }
            }
            if (result.evalDatasetConfig) {
                try {
                    parsedConfig.evalDataset = parse(result.evalDatasetConfig);
                    loadedCount++;
                } catch (e) { console.error('Error parsing evaldataset.toml', e); }
            }
            if (result.trainConfig) {
                try {
                    parsedConfig.train = parse(result.trainConfig);
                    loadedCount++;
                    // Extract model type from imported config
                    if (parsedConfig.train.model_type) {
                        setCurrentModelType(parsedConfig.train.model_type);
                    } else if (parsedConfig.train.model?.type) {
                        setCurrentModelType(parsedConfig.train.model.type);
                    }
                } catch (e) { console.error('Error parsing trainconfig.toml', e); }
            }

            if (loadedCount > 0) {
                setImportedConfig(parsedConfig);
                showToast(t('common.config_loaded') || 'Project configuration loaded', 'success');
            } else {
                showToast(t('common.config_not_found') || 'No valid configuration files found', 'error');
            }
        } catch (error) {
            console.error("Load project error:", error);
            showToast("Failed to load project", 'error');
        }
    };

    // Check python status
    const checkPythonStatus = async () => {
        try {
            // @ts-ignore
            const info = await window.ipcRenderer.invoke('get-python-status');
            setPythonInfo(info);
        } catch (e) {
            console.error("Failed to check python status:", e);
        }
    };

    // Effect to load project when projectPath prop changes
    useEffect(() => {
        if (projectPath && projectPath !== lastLoadedPathRef.current) {
            lastLoadedPathRef.current = projectPath;
            // First, lock the session to this directory
            // @ts-ignore
            window.ipcRenderer.invoke('set-session-folder', projectPath);
            // Then load configurations
            loadProjectFromPath(projectPath);
            checkPythonStatus();
        } else if (!projectPath) {
            checkPythonStatus();
        }
    }, [projectPath]);

    const handleSwitchPython = async (path: string) => {
        try {
            // @ts-ignore
            const result = await window.ipcRenderer.invoke('set-python-env', path);
            if (result.success) {
                setPythonInfo(result);
                showToast(t('common.python_switched') || 'Python environment switched', 'success');
            }
        } catch (e) {
            console.error("Failed to switch python:", e);
        } finally {
            setIsEnvDropdownOpen(false);
        }
    };

    const handlePickCustomPython = async () => {
        try {
            // @ts-ignore
            const result = await window.ipcRenderer.invoke('pick-python-exe');
            if (result.success) {
                setPythonInfo({ ...result, availableEnvs: pythonInfo.availableEnvs }); // Maintain list
                showToast(t('common.python_switched') || 'Python environment switched', 'success');
            }
        } catch (e) {
            console.error("Failed to pick custom python:", e);
        } finally {
            setIsEnvDropdownOpen(false);
        }
    };

    // Close dropdown on click outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsEnvDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    const handleHomeClick = () => {
        showToast(t('common.config_saved'), 'success');
        setTimeout(() => {
            onBackToHome();
        }, 500);
    };

    const handleStartRename = () => {
        const currentName = projectPath?.split(/[/\\]/).filter(Boolean).pop() || '';
        setNewName(currentName);
        setIsRenaming(true);
    };

    const handleRenameSubmit = () => {
        if (!newName.trim() || newName === (projectPath?.split(/[/\\]/).filter(Boolean).pop())) {
            setIsRenaming(false);
            return;
        }
        setIsRenameConfirmOpen(true);
    };

    const confirmRename = async () => {
        if (!projectPath) return;
        try {
            const result = await window.ipcRenderer.invoke('rename-project-folder', {
                oldPath: projectPath,
                newName: newName.trim()
            });

            if (result.success) {
                showToast(t('common.project_renamed') || 'Project renamed successfully', 'success');
                if (onProjectRenamed) {
                    onProjectRenamed(result.newPath);
                }
            } else {
                showToast(result.error || 'Rename failed', 'error');
            }
        } catch (e: any) {
            showToast(e.message || 'Rename error', 'error');
        } finally {
            setIsRenameConfirmOpen(false);
            setIsRenaming(false);
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        // Force copy effect to allow WSL2/Network paths (fixes 🚫 icon)
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'copy';
        }
        // Only allow dropping files
        if (e.dataTransfer.types.includes('Files')) {
            setIsDragging(true);
        }
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();

        // Check if we're actually leaving the container (and not just entering a child)
        if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget as Node)) {
            return;
        }

        setIsDragging(false);
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);

        if (!e.dataTransfer.types.includes('Files')) {
            return;
        }

        if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
            // Electron specific: file.path gives the full path
            const filePath = (e.dataTransfer.files[0] as any).path;
            const fileName = (e.dataTransfer.files[0] as any).name;

            const isTomlFile = fileName && fileName.endsWith('.toml');

            if (isTomlFile) {
                try {
                    // 1. Read content to determine type
                    let content = await window.ipcRenderer.invoke('read-file', filePath);
                    let targetName = fileName; // Default to original name
                    let detectedType: 'train' | 'dataset' | 'evalDataset' | null = null;
                    let parsed: any = null;

                    if (content) {
                        // Strip BOM if present
                        if (content.charCodeAt(0) === 0xFEFF) {
                            content = content.slice(1);
                        }

                        try {
                            parsed = parse(content);
                            // Sniffing logic
                            if (parsed.model || parsed.optimizer || parsed.output_dir || parsed.training_arguments || parsed.dataset) {
                                targetName = 'trainconfig.toml';
                                detectedType = 'train';
                            } else if (parsed.directory && Array.isArray(parsed.directory)) {
                                // Dataset or Eval - check active tab
                                if (activeTab === 'eval_dataset') {
                                    targetName = 'evaldataset.toml';
                                    detectedType = 'evalDataset';
                                } else {
                                    targetName = 'dataset.toml';
                                    detectedType = 'dataset';
                                }
                            } else if (parsed.datasets && Array.isArray(parsed.datasets)) {
                                // Handle array of tables [[datasets]]
                                if (parsed.datasets[0]?.enable_ar_bucket !== undefined) {
                                    targetName = 'dataset.toml';
                                    detectedType = 'dataset';
                                } else {
                                    targetName = 'evaldataset.toml';
                                    detectedType = 'evalDataset';
                                }
                            } else if (parsed.general) {
                                targetName = 'dataset.toml';
                                detectedType = 'dataset';
                            }
                            // Debug toast
                            console.log('Parsed keys:', Object.keys(parsed));
                            // showToast(`Parsed keys: ${Object.keys(parsed).join(',')}`, 'success');
                        } catch (e: any) {
                            console.warn('Failed to parse dropped TOML for sniffing', e);
                            showToast(`TOML解析失败(可能是格式问题): ${e.message}`, 'error');
                        }
                    } else {
                        showToast(`无法读取文件: ${fileName}`, 'error');
                    }

                    // 2. Copy to date folder (renaming if detected)
                    const copyResult = await window.ipcRenderer.invoke('copy-to-date-folder', {
                        sourcePath: filePath,
                        filename: targetName
                    });

                    if (copyResult.success) {
                        const displayName = detectedType ? t(`dataset.${detectedType}_title`) || detectedType : targetName;
                        showToast(t('common.file_copied', { name: displayName }) || `Loaded ${displayName}`, 'success');
                        console.log(`[Layout] Copied/Renamed to: ${copyResult.path}`);

                        // 3. Update State
                        if (parsed && detectedType) {
                            const parsedConfig: any = {};
                            if (detectedType === 'train') {
                                parsedConfig.train = parsed;
                                if (parsed.model?.type || parsed.model_type) {
                                    setCurrentModelType(parsed.model?.type || parsed.model_type);
                                }
                            } else if (detectedType === 'dataset') {
                                parsedConfig.dataset = parsed;
                            } else if (detectedType === 'evalDataset') {
                                parsedConfig.evalDataset = parsed;
                            }

                            if (Object.keys(parsedConfig).length > 0) {
                                setImportedConfig((prev: any) => ({ ...prev, ...parsedConfig }));
                            }
                        } else if (fileName === 'dataset.toml' || fileName === 'evaldataset.toml' || fileName === 'trainconfig.toml') {
                            // Fallback for standard named files that failed parsing or sniffing?
                            // Actually if parsing failed, we can't load it. 
                            // But if sniffing failed but name is standard, try to load?
                            // parsed is null if parse failed.
                        }
                    } else {
                        showToast(`复制文件失败: ${copyResult.error}`, 'error');
                    }
                } catch (err) {
                    console.error('File drop error:', err);
                    showToast('文件处理错误', 'error');
                }
            } else {
                const copyResult = await window.ipcRenderer.invoke('copy-folder-configs-to-date', {
                    sourceFolderPath: filePath
                });

                if (copyResult.success && copyResult.copiedFiles.length > 0) {
                    showToast(`已复制 ${copyResult.copiedFiles.length} 个配置文件到项目文件夹`, 'success');
                    console.log(`[Layout] Copied to: ${copyResult.outputFolder}`);
                    // Reload from the session folder (where files were copied and mapped)
                    await loadProjectFromPath(copyResult.outputFolder);
                } else {
                    // Fallback or just loading a folder that might already be a project
                    await loadProjectFromPath(filePath);
                }
            }
        }
    };

    return (
        <div
            className="flex h-screen w-full overflow-hidden bg-gradient-to-br from-gray-50 to-gray-200 dark:from-gray-950 dark:to-gray-900 text-foreground transition-all duration-500 relative"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            {isDragging && (
                <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center pointer-events-none">
                    <div className="border-4 border-dashed border-primary/50 m-8 rounded-3xl p-20 text-center animate-in fade-in zoom-in-95 duration-300 bg-black/20">
                        <UploadCloud className="w-32 h-32 mx-auto text-primary mb-6 animate-bounce" />
                        <h2 className="text-4xl font-bold text-white mb-4">{t('drop_zone.title')}</h2>
                        <p className="text-xl text-white/80">{t('drop_zone.desc')}</p>
                    </div>
                </div>
            )}

            {/* Sidebar */}
            <Sidebar
                activeTab={activeTab}
                onTabChange={setActiveTab}
                theme={theme}
                onThemeToggle={toggleTheme}
            />

            {/* Main Content Area */}
            <main className="flex-1 overflow-y-auto p-6 relative">
                {/* Background blobs for aesthetic */}
                <div className="fixed top-0 left-0 w-full h-full overflow-hidden pointer-events-none z-0">
                    <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-purple-500/20 rounded-full blur-[100px] animate-blob" />
                    <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-blue-500/20 rounded-full blur-[100px] animate-blob animation-delay-2000" />
                </div>

                <div className="relative z-10 max-w-[1600px] mx-auto space-y-6">
                    <header className="flex items-center justify-between mb-8">
                        <div className="flex flex-col">
                            <h1 className="text-3xl font-bold tracking-tight text-foreground flex items-center gap-2">
                                <span className="opacity-70 font-medium">{t('app.project_name')}: </span>
                                {isRenaming ? (
                                    <input
                                        autoFocus
                                        className="bg-black/10 dark:bg-white/10 border-2 border-primary/50 focus:border-primary rounded-xl outline-none px-3 py-1 min-w-[240px] text-2xl font-bold transition-all shadow-lg backdrop-blur-md"
                                        value={newName}
                                        onChange={(e) => setNewName(e.target.value)}
                                        onBlur={handleRenameSubmit}
                                        onKeyDown={(e) => e.key === 'Enter' && handleRenameSubmit()}
                                    />
                                ) : (
                                    <span
                                        className="cursor-pointer hover:text-primary transition-all border-b-2 border-dashed border-blue-500 hover:border-blue-600 pb-0.5"
                                        onClick={handleStartRename}
                                        title={t('common.click_to_rename') || "Click to rename"}
                                    >
                                        {projectPath ? (projectPath.split(/[/\\]/).filter(Boolean).pop() || 'Untitled Project') : t('app.title')}
                                    </span>
                                )}
                            </h1>
                            {projectPath && (
                                <p className="text-sm text-muted-foreground flex items-center gap-1 mt-1 opacity-70">
                                    <FolderOpen className="w-3.5 h-3.5" />
                                    {projectPath}
                                </p>
                            )}
                        </div>
                        <div className="flex items-center gap-4 relative" ref={dropdownRef}>
                            <div
                                onClick={() => setIsEnvDropdownOpen(!isEnvDropdownOpen)}
                                className={`flex items-center gap-2 px-3 py-1.5 rounded-full border transition-all cursor-pointer hover:scale-105 active:scale-95 ${pythonInfo.status === 'ready'
                                    ? 'bg-green-500/10 border-green-500/20 text-green-600 dark:text-green-400'
                                    : 'bg-red-500/10 border-red-500/20 text-red-600 dark:text-red-400 animate-pulse'
                                    }`}
                                title={pythonInfo.path || t('app.python_not_found')}
                            >
                                {pythonInfo.status === 'ready' ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                                <div className="flex flex-col items-start leading-tight">
                                    <span className="text-[10px] uppercase tracking-wider opacity-60 font-bold">
                                        {pythonInfo.status === 'ready' ? t('app.ready') : t('app.not_ready')}
                                    </span>
                                    <span className="text-xs truncate max-w-[150px]">
                                        {pythonInfo.displayName || (pythonInfo.path ? pythonInfo.path.split(/[/\\]/).pop() : t('app.python_not_found'))}
                                    </span>
                                </div>
                                <ChevronDown className={`w-3 h-3 ml-1 opacity-50 transition-transform ${isEnvDropdownOpen ? 'rotate-180' : ''}`} />
                            </div>

                            {/* Dropdown Menu */}
                            {isEnvDropdownOpen && (
                                <div className="absolute top-full right-0 mt-2 w-64 bg-white/80 dark:bg-gray-900/80 backdrop-blur-xl border border-gray-200 dark:border-white/10 rounded-2xl shadow-2xl z-[100] py-2 overflow-hidden animate-in fade-in zoom-in-95 duration-200">
                                    <div className="px-3 py-2 text-[10px] uppercase font-bold text-muted-foreground border-b border-gray-100 dark:border-white/5 mb-1">
                                        {t('project.available_envs') || 'Detected Environments'}
                                    </div>
                                    <div className="max-h-64 overflow-y-auto">
                                        {pythonInfo.availableEnvs.map((env) => (
                                            <button
                                                key={env.path}
                                                onClick={() => handleSwitchPython(env.path)}
                                                className={`w-full text-left px-4 py-3 text-sm flex items-center justify-between hover:bg-primary/10 transition-colors ${pythonInfo.path === env.path ? 'text-primary font-bold' : ''
                                                    }`}
                                            >
                                                <span className="truncate mr-2">{env.name}</span>
                                                {pythonInfo.path === env.path && <CheckCircle2 className="w-4 h-4" />}
                                                {env.name === 'python_embeded_DP' && <span className="text-[9px] bg-primary/20 text-primary px-1.5 py-0.5 rounded uppercase ml-auto">{t('app.internal')}</span>}
                                            </button>
                                        ))}
                                        {pythonInfo.availableEnvs.length === 0 && (
                                            <div className="px-4 py-3 text-xs text-muted-foreground italic">No environments detected</div>
                                        )}
                                    </div>
                                    <div className="border-t border-gray-100 dark:border-white/5 mt-1 pt-1">
                                        <button
                                            onClick={handlePickCustomPython}
                                            className="w-full text-left px-4 py-3 text-sm flex items-center gap-2 hover:bg-primary/10 text-primary transition-colors"
                                        >
                                            <FolderOpen className="w-4 h-4" />
                                            {t('common.select_other_path') || 'Select Other Path...'}
                                        </button>
                                    </div>
                                </div>
                            )}
                            <GlassButton onClick={handleHomeClick} size="icon" className="rounded-full w-10 h-10 border-gray-200 dark:border-white/20 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10" title="Home">
                                <Home className="w-5 h-5 text-gray-900 dark:text-white" />
                            </GlassButton>
                        </div>
                    </header>

                    <div className="min-h-[600px] animate-in fade-in slide-in-from-bottom-4 duration-500">
                        <div style={{ display: activeTab === 'dataset' ? 'block' : 'none' }}>
                            <DatasetConfig
                                mode="training"
                                importedConfig={importedConfig?.dataset}
                                modelType={currentModelType}
                                modelVersion={currentModelVersion}
                                onPathsChange={(paths) => setTrainPath(paths[0] || '')}
                            />
                        </div>
                        <div style={{ display: activeTab === 'eval_dataset' ? 'block' : 'none' }}>
                            <DatasetConfig
                                mode="evaluation"
                                importedConfig={importedConfig?.evalDataset}
                                modelType={currentModelType}
                                modelVersion={currentModelVersion}
                                onPathsChange={setEvalPaths}
                                onSetsChange={setEvalSets}
                            />
                        </div>
                        <div style={{ display: activeTab === 'training_setup' ? 'block' : 'none' }}>
                            <ModelTrainingPage
                                importedConfig={importedConfig?.train}
                                globalModelType={currentModelType}
                                setGlobalModelType={setCurrentModelType}
                                setGlobalModelVersion={setCurrentModelVersion}
                                evalSets={evalSets}
                            />
                        </div>
                        <div style={{ display: activeTab === 'training_run' ? 'block' : 'none' }}>
                            {activeTab === 'training_run' && (
                                <TrainingLauncherPage
                                    projectPath={projectPath}
                                />
                            )}
                        </div>
                        <div style={{ display: activeTab === 'monitor' ? 'block' : 'none' }}>
                            <MonitorPage
                                initialLogDir={importedConfig?.train?.output_dir}
                                projectPath={projectPath}
                            />
                        </div>
                        <div style={{ display: activeTab === 'resource_monitor' ? 'block' : 'none' }}>
                            {activeTab === 'resource_monitor' && <ResourceMonitor />}
                        </div>
                        <div style={{ display: activeTab === 'training_log' ? 'block' : 'none' }}>
                            {activeTab === 'training_log' && <TrainingLogPage projectPath={projectPath} />}
                        </div>

                        {/* Dialogs */}
                    </div>
                </div>
            </main>

            <GlassConfirmDialog
                isOpen={isPathConflictDialogOpen}
                onClose={() => setIsPathConflictDialogOpen(false)}
                onConfirm={() => setIsPathConflictDialogOpen(false)}
                title={
                    <div className="flex items-center gap-2 text-amber-500">
                        <AlertTriangle className="w-6 h-6" />
                        <span>{t('validation.same_path_warning').split('：')[0] || 'Path Conflict'}</span>
                    </div>
                }
                description={t('validation.same_path_warning')}
                confirmText={t('common.confirm')}
                cancelText={t('validation.change_path')}
            />

            <GlassConfirmDialog
                isOpen={isRenameConfirmOpen}
                onClose={() => {
                    setIsRenameConfirmOpen(false);
                    setIsRenaming(false);
                }}
                onConfirm={confirmRename}
                title={
                    <div className="flex items-center gap-2 text-primary">
                        <FolderOpen className="w-6 h-6" />
                        <span>{t('project.rename_title') || 'Rename Project'}</span>
                    </div>
                }
                description={
                    <span>
                        {t('project.rename_confirm_desc') || 'Are you sure you want to rename this project to'}
                        <strong className="mx-1 text-primary">"{newName}"</strong>?
                    </span>
                }
                confirmText={t('common.confirm')}
                cancelText={t('common.cancel')}
            />
        </div>
    );
}
