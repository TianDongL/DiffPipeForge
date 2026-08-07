import { ipc } from '@/lib/ipc';
import React from 'react';
import { GlassCard } from './ui/GlassCard';
import { GlassInput } from './ui/GlassInput';
import { HelpIcon } from './ui/HelpIcon';
import { useTranslation } from 'react-i18next';
import { FolderOpen, LoaderCircle, RefreshCw } from 'lucide-react';

interface TrainingCheckpointOption {
    name: string;
    path: string;
    latestTag: string;
    step: number | null;
    modifiedAt: number;
}

interface CheckpointDiscoveryResult {
    outputDir: string;
    checkpoints: TrainingCheckpointOption[];
}

interface PathInputProps {
    label: string;
    helpText?: string;
    name: string;
    value: string;
    placeholder?: string;
    isFolder?: boolean;
    className?: string;
    list?: string;
    browseTitle: string;
    defaultPath?: string;
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
    onPickPath: (name: string, isFolder: boolean, defaultPath?: string) => void;
}

function PathInput({
    label,
    helpText,
    name,
    value,
    placeholder,
    isFolder = false,
    className,
    list,
    browseTitle,
    defaultPath,
    onChange,
    onPickPath
}: PathInputProps) {
    return (
        <div className={className ?? ''}>
            <div className="flex items-end gap-2">
                <div className="min-w-0 flex-1">
                    <GlassInput
                        label={label}
                        helpText={helpText}
                        name={name}
                        value={value}
                        onChange={onChange}
                        placeholder={placeholder}
                        list={list}
                        autoComplete="off"
                        className="h-11"
                    />
                </div>
                <button
                    type="button"
                    onClick={() => onPickPath(name, isFolder, defaultPath)}
                    className="inline-flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-gray-200 bg-white/40 text-muted-foreground shadow-sm backdrop-blur-md transition-colors hover:border-gray-300 hover:bg-black/5 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 dark:border-white/10 dark:bg-white/5 dark:hover:border-white/20 dark:hover:bg-white/10"
                    title={browseTitle}
                    aria-label={browseTitle}
                >
                    <FolderOpen className="h-4 w-4" />
                </button>
            </div>
        </div>
    );
}

export interface StartParamsConfigProps {
    data: StartParamsData;
    onChange: React.Dispatch<React.SetStateAction<StartParamsData>>;
    configPath?: string | null;
}

export interface StartParamsData {
    resume_from_checkpoint: string;
    regenerate_cache: boolean;
    trust_cache: boolean;
    cache_only: boolean;
    reset_dataloader: boolean;
    reset_optimizer_params: boolean;
    i_know_what_i_am_doing: boolean;
    dump_dataset: string;
    num_gpus: number;
}

export function StartParamsConfig({ data, onChange, configPath }: StartParamsConfigProps) {
    const { t } = useTranslation();
    const [platform, setPlatform] = React.useState<string>('');
    const [checkpointDiscovery, setCheckpointDiscovery] = React.useState<CheckpointDiscoveryResult>({
        outputDir: '',
        checkpoints: []
    });
    const [isScanningCheckpoints, setIsScanningCheckpoints] = React.useState(false);
    const [checkpointScanError, setCheckpointScanError] = React.useState('');
    const checkpointRequestId = React.useRef(0);

    React.useEffect(() => {
        const fetchPlatform = async () => {
            try {
                // @ts-ignore
                const p = await ipc.invoke('get-platform');
                setPlatform(p);
            } catch (e) {
                console.error("Failed to fetch platform:", e);
            }
        };
        fetchPlatform();
    }, []);

    const scanCheckpoints = React.useCallback(async () => {
        const requestId = ++checkpointRequestId.current;
        if (!configPath) {
            setCheckpointDiscovery({ outputDir: '', checkpoints: [] });
            setCheckpointScanError('');
            setIsScanningCheckpoints(false);
            return;
        }

        setIsScanningCheckpoints(true);
        setCheckpointScanError('');
        setCheckpointDiscovery({ outputDir: '', checkpoints: [] });
        try {
            const result = await ipc.invoke('list-resume-checkpoints', configPath) as CheckpointDiscoveryResult;
            if (requestId !== checkpointRequestId.current) return;
            setCheckpointDiscovery({
                outputDir: result?.outputDir ?? '',
                checkpoints: Array.isArray(result?.checkpoints) ? result.checkpoints : []
            });
        } catch (error) {
            if (requestId !== checkpointRequestId.current) return;
            console.error('Failed to scan training checkpoints:', error);
            setCheckpointDiscovery({ outputDir: '', checkpoints: [] });
            setCheckpointScanError(error instanceof Error ? error.message : String(error));
        } finally {
            if (requestId === checkpointRequestId.current) {
                setIsScanningCheckpoints(false);
            }
        }
    }, [configPath]);

    React.useEffect(() => {
        void scanCheckpoints();
        return () => {
            checkpointRequestId.current += 1;
        };
    }, [scanCheckpoints]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
        onChange((current) => ({ ...current, [e.target.name]: value }));
    };

    const handlePickPath = async (name: string, isFolder: boolean = false, defaultPath?: string) => {
        try {
            // @ts-ignore
            const result = await ipc.invoke('dialog:openFile', {
                properties: isFolder ? ['openDirectory'] : ['openFile'],
                filters: isFolder ? [] : [{ name: 'Model Files', extensions: ['safetensors', 'pt', 'ckpt', 'bin'] }],
                ...(defaultPath ? { defaultPath } : {})
            });

            if (!result.canceled && result.filePaths.length > 0) {
                onChange((current) => ({ ...current, [name]: result.filePaths[0] }));
            }
        } catch (e) {
            console.error("Failed to pick path:", e);
        }
    };

    return (
        <GlassCard className="p-6">
            <div className="mb-6">
                <h3 className="text-2xl font-bold">{t('start_params.title')}</h3>
                <p className="text-sm text-muted-foreground">{t('start_params.desc')}</p>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                <div className="md:col-span-2 space-y-2">
                    <PathInput
                        label={t('start_params.resume_from_checkpoint')}
                        helpText={t('help.resume_from_checkpoint')}
                        name="resume_from_checkpoint"
                        value={data.resume_from_checkpoint ?? ''}
                        placeholder={t('start_params.resume_placeholder')}
                        isFolder={true}
                        list="detected-resume-checkpoints"
                        browseTitle={t('start_params.choose_checkpoint_folder')}
                        defaultPath={checkpointDiscovery.outputDir}
                        onChange={handleChange}
                        onPickPath={handlePickPath}
                    />
                    <datalist id="detected-resume-checkpoints">
                        {checkpointDiscovery.checkpoints.map((checkpoint) => (
                            <option
                                key={checkpoint.path}
                                value={checkpoint.path}
                                label={`${checkpoint.name} · ${checkpoint.latestTag}`}
                            />
                        ))}
                    </datalist>
                    <div className="flex items-start justify-between gap-3 px-1 text-xs text-muted-foreground">
                        <div className="min-w-0">
                            {isScanningCheckpoints ? (
                                <span className="inline-flex items-center gap-1.5">
                                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                                    {t('start_params.scanning_checkpoints')}
                                </span>
                            ) : checkpointScanError ? (
                                <span className="text-amber-500" title={checkpointScanError}>
                                    {t('start_params.checkpoint_scan_failed')}
                                </span>
                            ) : checkpointDiscovery.checkpoints.length > 0 ? (
                                <span title={checkpointDiscovery.outputDir}>
                                    {t('start_params.checkpoints_found', { count: checkpointDiscovery.checkpoints.length })}
                                </span>
                            ) : (
                                <span title={checkpointDiscovery.outputDir}>
                                    {t('start_params.no_checkpoints_found')}
                                </span>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={() => void scanCheckpoints()}
                            disabled={!configPath || isScanningCheckpoints}
                            className="shrink-0 inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-white/10 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
                            title={t('start_params.refresh_checkpoints')}
                        >
                            <RefreshCw className="h-3.5 w-3.5" />
                            {t('start_params.refresh')}
                        </button>
                    </div>
                </div>

                <PathInput
                    label={t('start_params.dump_dataset')}
                    helpText={t('help.dump_dataset')}
                    name="dump_dataset"
                    value={data.dump_dataset ?? ''}
                    placeholder="C:\\debug\\dataset"
                    isFolder={true}
                    className="md:col-span-2"
                    browseTitle={t('project.open')}
                    onChange={handleChange}
                    onPickPath={handlePickPath}
                />

                <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-2">
                        <input type="checkbox" name="regenerate_cache" id="regenerate_cache" className="w-4 h-4" checked={!!data.regenerate_cache} onChange={handleChange} />
                        <label htmlFor="regenerate_cache" className="text-sm flex items-center gap-1 cursor-pointer">
                            {t('start_params.regenerate_cache')}
                            <HelpIcon text={t('help.regenerate_cache')} />
                        </label>
                    </div>
                    <div className="flex items-center gap-2">
                        <input type="checkbox" name="trust_cache" id="trust_cache" className="w-4 h-4" checked={!!data.trust_cache} onChange={handleChange} />
                        <label htmlFor="trust_cache" className="text-sm flex items-center gap-1 cursor-pointer">
                            {t('start_params.trust_cache')}
                            <HelpIcon text={t('help.trust_cache')} />
                        </label>
                    </div>
                    <div className="flex items-center gap-2">
                        <input type="checkbox" name="cache_only" id="cache_only" className="w-4 h-4" checked={!!data.cache_only} onChange={handleChange} />
                        <label htmlFor="cache_only" className="text-sm flex items-center gap-1 cursor-pointer">
                            {t('start_params.cache_only')}
                            <HelpIcon text={t('help.cache_only')} />
                        </label>
                    </div>
                </div>

                <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-2">
                        <input type="checkbox" name="reset_dataloader" id="reset_dataloader" className="w-4 h-4" checked={!!data.reset_dataloader} onChange={handleChange} />
                        <label htmlFor="reset_dataloader" className="text-sm flex items-center gap-1 cursor-pointer">
                            {t('start_params.reset_dataloader')}
                            <HelpIcon text={t('help.reset_dataloader')} />
                        </label>
                    </div>
                    <div className="flex items-center gap-2">
                        <input type="checkbox" name="reset_optimizer_params" id="reset_optimizer_params" className="w-4 h-4" checked={!!data.reset_optimizer_params} onChange={handleChange} />
                        <label htmlFor="reset_optimizer_params" className="text-sm flex items-center gap-1 cursor-pointer">
                            {t('start_params.reset_optimizer_params')}
                            <HelpIcon text={t('help.reset_optimizer_params')} />
                        </label>
                    </div>
                    <div className="flex items-center gap-2">
                        <input type="checkbox" name="i_know_what_i_am_doing" id="i_know_what_i_am_doing" className="w-4 h-4" checked={!!data.i_know_what_i_am_doing} onChange={handleChange} />
                        <label htmlFor="i_know_what_i_am_doing" className="text-sm text-red-400 font-medium flex items-center gap-1 cursor-pointer">
                            {t('start_params.i_know_what_i_am_doing')}
                            <HelpIcon text={t('help.i_know_what_i_am_doing')} />
                        </label>
                    </div>

                    {platform !== 'win32' && (
                        <div className="mt-2">
                            <GlassInput
                                label={t('start_params.num_gpus')}
                                helpText={t('help.num_gpus')}
                                name="num_gpus"
                                type="number"
                                min={1}
                                value={data.num_gpus ?? 1}
                                onChange={handleChange}
                            />
                        </div>
                    )}
                </div>
            </div>
        </GlassCard>
    );
}
