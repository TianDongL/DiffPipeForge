import { useState, useEffect } from 'react';
import { GlassCard } from './ui/GlassCard';
import { Plus, FolderOpen, Clock, FileCode, Trash2, AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { parse } from 'smol-toml';
import { GlassButton } from './ui/GlassButton';
import { GlassConfirmDialog } from './ui/GlassConfirmDialog';
import { useGlassToast } from './ui/GlassToast';

export interface ProjectSelectionPageProps {
    onSelect: (projectPath: string) => void;
}

interface Project {
    name: string;
    path: string;
    lastModified: string;
}

export function ProjectSelectionPage({ onSelect }: ProjectSelectionPageProps) {
    const { t } = useTranslation();
    const { showToast } = useGlassToast();
    const [projects, setProjects] = useState<Project[]>([]);
    const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
    const [projectToDelete, setProjectToDelete] = useState<string | null>(null);
    const [versionDialogOpen, setVersionDialogOpen] = useState(false);
    const [isDragging, setIsDragging] = useState(false);

    useEffect(() => {
        const loadProjects = async () => {
            try {
                const recent = await window.ipcRenderer.invoke('get-recent-projects');
                setProjects(recent);
            } catch (error) {
                console.error("Failed to load recent projects", error);
            }
        };
        loadProjects();
    }, []);

    const addToHistory = async (path: string) => {
        const name = path.split('\\').pop() || 'Untitled Project';
        const project: Project = {
            name,
            path,
            lastModified: new Date().toLocaleString()
        };
        const updated = await window.ipcRenderer.invoke('add-recent-project', project);
        setProjects(updated);
    };

    const handleDeleteClick = (e: React.MouseEvent, path: string) => {
        e.stopPropagation();
        setProjectToDelete(path);
        setDeleteDialogOpen(true);
    };

    const confirmDelete = async () => {
        if (projectToDelete) {
            try {
                const result = await window.ipcRenderer.invoke('delete-project-folder', projectToDelete);
                if (result.success) {
                    setProjects(result.projects);
                    showToast(t('common.project_deleted') || 'Project deleted', 'success');
                } else {
                    showToast(`Delete failed: ${result.error}`, 'error');
                }
            } catch (error: any) {
                showToast(`Delete error: ${error.message}`, 'error');
            }
        }
        setDeleteDialogOpen(false);
        setProjectToDelete(null);
    };



    const handleNewProject = async () => {
        const result = await window.ipcRenderer.invoke('create-new-project');
        if (result.success) {
            await addToHistory(result.path);
            onSelect(result.path);
        }
    };

    return (
        <div
            className="flex flex-col h-screen w-full items-center justify-center bg-gradient-to-br from-gray-50 to-gray-200 dark:from-gray-950 dark:to-gray-900 overflow-hidden relative p-8"
            onDragOver={(e) => {
                e.preventDefault();
                if (e.dataTransfer) {
                    e.dataTransfer.dropEffect = 'copy';
                }
                if (e.dataTransfer.types.includes('Files')) {
                    setIsDragging(true);
                }
            }}
            onDragLeave={(e) => {
                e.preventDefault();
                if (e.relatedTarget && e.currentTarget.contains(e.relatedTarget as Node)) {
                    return;
                }
                setIsDragging(false);
            }}
            onDrop={async (e) => {
                e.preventDefault();
                setIsDragging(false);

                // Copy logic from single card drop, but for the whole page
                if (!e.dataTransfer.types.includes('Files')) return;
                if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                    const file = e.dataTransfer.files[0];
                    const filePath = (file as any).path;
                    const fileName = (file as any).name;

                    if (fileName.endsWith('.toml')) {
                        // Reuse TOML logic
                        try {
                            const content = await window.ipcRenderer.invoke('read-file', filePath);
                            if (content) {
                                const parsed = parse(content);
                                let targetName = fileName;
                                if (parsed.model || parsed.optimizer || parsed.output_dir || parsed.training_arguments || parsed.dataset) {
                                    targetName = 'trainconfig.toml';
                                } else if (parsed.directory || (parsed.datasets && Array.isArray(parsed.datasets) && (parsed.datasets as any[])[0]?.enable_ar_bucket !== undefined)) {
                                    targetName = 'dataset.toml';
                                } else if (parsed.datasets) {
                                    targetName = 'evaldataset.toml';
                                }

                                const copyResult = await window.ipcRenderer.invoke('copy-to-date-folder', {
                                    sourcePath: filePath,
                                    filename: targetName
                                });

                                if (copyResult.success) {
                                    const savedPath = copyResult.path;
                                    const folderPath = savedPath.substring(0, Math.max(savedPath.lastIndexOf('/'), savedPath.lastIndexOf('\\')));
                                    await addToHistory(folderPath);
                                    onSelect(folderPath);
                                }
                            }
                        } catch (err) { console.error('Full page drop error:', err); }
                    } else {
                        // Folder or other
                        const result = await window.ipcRenderer.invoke('copy-folder-configs-to-date', {
                            sourceFolderPath: filePath
                        });
                        if (result.success) {
                            await addToHistory(result.outputFolder);
                            onSelect(result.outputFolder);
                        } else {
                            await addToHistory(filePath);
                            onSelect(filePath);
                        }
                    }
                }
            }}
        >
            {/* Background blobs */}
            <div className="absolute top-[-10%] left-[-10%] w-[500px] h-[500px] bg-purple-500/20 rounded-full blur-[100px] animate-blob pointer-events-none" />
            <div className="absolute bottom-[-10%] right-[-10%] w-[500px] h-[500px] bg-blue-500/20 rounded-full blur-[100px] animate-blob animation-delay-2000 pointer-events-none" />

            <div className="max-w-4xl w-full space-y-8 z-10 flex-1 flex flex-col justify-center">
                <div className="text-center space-y-2">
                    <h1 className="text-6xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-blue-600 to-violet-600 dark:from-blue-400 dark:to-violet-400 pb-2">
                        DiffPipe Forge
                    </h1>
                    <h2 className="text-2xl font-bold tracking-tight text-gray-700 dark:text-gray-200">
                        {t('project.select_title')}
                    </h2>
                    <p className="text-muted-foreground">{t('project.select_desc')}</p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 max-w-2xl mx-auto w-full">
                    {/* New Project Card */}
                    <GlassCard
                        className="p-8 flex flex-col items-center justify-center gap-4 cursor-pointer hover:bg-white/50 dark:hover:bg-white/10 transition-all group border-dashed border-2 min-h-[200px] hover:scale-[1.02]"
                        onClick={handleNewProject}
                    >
                        <div className="p-4 rounded-full bg-indigo-500/10 text-indigo-500 group-hover:scale-110 transition-transform">
                            <Plus className="w-8 h-8" />
                        </div>
                        <div className="text-center">
                            <h3 className="text-xl font-semibold">{t('project.new')}</h3>
                            <p className="text-xs text-muted-foreground mt-1 max-w-[200px]">
                                {t('project.new_desc')}
                            </p>
                        </div>
                    </GlassCard>

                    {/* Open Project Card */}
                    <GlassCard
                        className="p-8 flex flex-col items-center justify-center gap-4 cursor-pointer hover:bg-white/50 dark:hover:bg-white/10 transition-all group border-dashed border-2 min-h-[200px] hover:scale-[1.02]"
                        onClick={async () => {
                            const result = await window.ipcRenderer.invoke('dialog:openFile', {
                                properties: ['openDirectory']
                            });
                            if (!result.canceled && result.filePaths.length > 0) {
                                const filePath = result.filePaths[0];
                                // Prepare the output folder by copying configs
                                await window.ipcRenderer.invoke('copy-folder-configs-to-date', {
                                    sourceFolderPath: filePath
                                });
                                await addToHistory(filePath);
                                onSelect(filePath);
                            }
                        }}
                        onDragOver={(e) => {
                            e.preventDefault();
                            if (e.dataTransfer.types.includes('Files')) {
                                e.currentTarget.classList.add('bg-white/50', 'dark:bg-white/20');
                            }
                        }}
                        onDragLeave={(e) => {
                            e.preventDefault();
                            e.currentTarget.classList.remove('bg-white/50', 'dark:bg-white/20');
                        }}
                        onDrop={async (e) => {
                            e.preventDefault();
                            e.currentTarget.classList.remove('bg-white/50', 'dark:bg-white/20');

                            if (!e.dataTransfer.types.includes('Files')) {
                                return;
                            }

                            if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
                                const filePath = (e.dataTransfer.files[0] as any).path;
                                const fileName = (e.dataTransfer.files[0] as any).name;

                                const isTomlFile = fileName && fileName.endsWith('.toml');

                                if (isTomlFile) {
                                    try {
                                        // 1. Read content to determine type
                                        let content = await window.ipcRenderer.invoke('read-file', filePath);
                                        let targetName = fileName;
                                        let detectedType: 'train' | 'dataset' | 'evalDataset' | null = null;
                                        let parsed: any = null;

                                        if (content) {
                                            // Strip BOM
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
                                                    // Default to dataset.toml for new projects
                                                    targetName = 'dataset.toml';
                                                    detectedType = 'dataset';
                                                } else if (parsed.datasets && Array.isArray(parsed.datasets)) {
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
                                                console.log('ProjectSelection Parsed keys:', Object.keys(parsed));
                                            } catch (e: any) {
                                                console.warn('Failed to parse dropped TOML', e);
                                                // Don't error out, try to copy as is or default name checking
                                            }
                                        }

                                        // 2. Copy to date folder
                                        const copyResult = await window.ipcRenderer.invoke('copy-to-date-folder', {
                                            sourcePath: filePath,
                                            filename: targetName
                                        });

                                        if (copyResult.success) {
                                            // Extract folder path from the copied file path
                                            // Support Windows backslash and forward slash
                                            const savedPath = copyResult.path;
                                            const folderPath = savedPath.substring(0, Math.max(savedPath.lastIndexOf('/'), savedPath.lastIndexOf('\\')));

                                            // For new projects, we want to open the folder where the config was saved
                                            console.log(`Created project from ${detectedType || 'unknown'} config at ${folderPath}`);
                                            await addToHistory(folderPath);
                                            onSelect(folderPath);
                                        } else {
                                            console.error(`Copy failed: ${copyResult.error}`);
                                        }
                                    } catch (err) {
                                        console.error('File drop error:', err);
                                    }
                                } else {
                                    const result = await window.ipcRenderer.invoke('copy-folder-configs-to-date', {
                                        sourceFolderPath: filePath
                                    });
                                    if (result.success) {
                                        await addToHistory(result.outputFolder);
                                        onSelect(result.outputFolder);
                                    } else {
                                        // If not a folder, maybe just open it?
                                        await addToHistory(filePath);
                                        onSelect(filePath);
                                    }
                                }
                            }
                        }}
                    >
                        <div className="p-4 rounded-full bg-emerald-500/10 text-emerald-500 group-hover:scale-110 transition-transform">
                            <FolderOpen className="w-8 h-8" />
                        </div>
                        <div className="text-center">
                            <h3 className="text-xl font-semibold">{t('project.open')}</h3>
                            <p className="text-xs text-muted-foreground mt-1 max-w-[200px]">
                                {t('project.open_desc')}
                            </p>
                        </div>
                    </GlassCard>
                </div>

                {isDragging && (
                    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center pointer-events-none">
                        <div className="border-4 border-dashed border-primary/50 m-8 rounded-3xl p-20 text-center animate-in fade-in zoom-in-95 duration-300 bg-black/20">
                            <Plus className="w-32 h-32 mx-auto text-primary mb-6 animate-bounce" />
                            <h2 className="text-4xl font-bold text-white mb-4">{t('drop_zone.title') || 'Drop Project Here'}</h2>
                            <p className="text-xl text-white/80">{t('drop_zone.desc') || 'Drop folder or TOML to open project'}</p>
                        </div>
                    </div>
                )}

                <div className="space-y-4">
                    <div className="flex items-center justify-between px-1">
                        <h2 className="text-xl font-semibold">{t('project.recent')}</h2>
                    </div>

                    <div className="grid gap-4 max-h-[300px] overflow-y-auto pr-2 custom-scrollbar">
                        {projects.length > 0 ? (
                            projects.map((project, index) => (
                                <GlassCard
                                    key={index}
                                    className="p-4 flex items-center justify-between cursor-pointer hover:bg-white/50 dark:hover:bg-white/10 transition-colors group"
                                    onClick={() => onSelect(project.path)}
                                >
                                    <div className="flex items-center gap-4 flex-1">
                                        <div className="p-2 rounded-lg bg-gray-500/10 text-gray-500">
                                            <FileCode className="w-6 h-6" />
                                        </div>
                                        <div>
                                            <h3 className="font-medium text-lg">{project.name}</h3>
                                            <p className="text-sm text-muted-foreground flex items-center gap-1">
                                                <FolderOpen className="w-3 h-3" />
                                                {project.path}
                                            </p>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-4">
                                        <div className="text-sm text-muted-foreground flex items-center gap-2">
                                            <Clock className="w-3 h-3" />
                                            {project.lastModified}
                                        </div>
                                        <GlassButton
                                            size="icon"
                                            className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/10 hover:text-red-500 border-none shadow-none"
                                            onClick={(e) => handleDeleteClick(e, project.path)}
                                            title={t('common.remove_recent') || "Delete Project"}
                                        >
                                            <Trash2 className="w-4 h-4" />
                                        </GlassButton>
                                    </div>
                                </GlassCard>
                            ))
                        ) : (
                            <div className="text-center text-muted-foreground py-8">
                                {t('project.no_recent')}
                            </div>
                        )}
                    </div>
                </div>
            </div>



            <div className="z-10 mt-8 flex items-center gap-4">
                <button
                    onClick={() => setVersionDialogOpen(true)}
                    className="text-sm animate-shine hover:opacity-80 transition-opacity"
                >
                    DiffPipe in ComfyUI
                </button>
                <span className="text-white/20">|</span>
                <a
                    href="https://space.bilibili.com/32275117"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm animate-shine"
                >
                    {t('project.author_credit')}
                </a>
                <span className="text-white/20">|</span>
                <a
                    href="https://github.com/tdrussell/diffusion-pipe"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm animate-shine"
                >
                    Diffusion Pipe
                </a>
            </div>

            {/* Version Selection Dialog */}
            <GlassConfirmDialog
                isOpen={versionDialogOpen}
                onClose={() => setVersionDialogOpen(false)}
                onConfirm={() => { }} // Not used
                hideConfirm
                title={t('app.select_version')}
                description={
                    <div className="flex gap-4 justify-center mt-4">
                        <GlassButton
                            onClick={() => {
                                window.open('https://github.com/TianDongL/Diffusion_pipe_in_ComfyUI_Win', '_blank');
                                setVersionDialogOpen(false);
                            }}
                            className="flex-1 font-bold"
                        >
                            {t('app.version_win')}
                        </GlassButton>
                        <GlassButton
                            onClick={() => {
                                window.open('https://github.com/TianDongL/Diffusion_pipe_in_ComfyUI', '_blank');
                                setVersionDialogOpen(false);
                            }}
                            className="flex-1 font-bold"
                        >
                            {t('app.version_linux')}
                        </GlassButton>
                    </div>
                }
                confirmText=""
                cancelText={t('common.cancel')}
            />

            <GlassConfirmDialog
                isOpen={deleteDialogOpen}
                onClose={() => setDeleteDialogOpen(false)}
                onConfirm={confirmDelete}
                title={
                    <div className="flex items-center gap-2 text-red-500">
                        <AlertTriangle className="w-6 h-6" />
                        <span>{t('common.delete_project_title')}</span>
                    </div>
                }
                description={t('common.delete_project_desc')}
                confirmText={t('common.confirm_delete')}
                cancelText={t('common.cancel')}
            />
        </div >
    );
}
