import { ipc } from '@/lib/ipc';
import { useState, useEffect } from 'react';
import { Play, Square, Settings, FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { GlassCard } from './ui/GlassCard';
import { GlassButton } from './ui/GlassButton';
import { useGlassToast } from './ui/GlassToast';
import { StartParamsConfig } from './StartParamsConfig';
import { cn } from '@/lib/utils';
import { parse } from 'smol-toml';
import { TrainingLogViewer } from './TrainingLogViewer';
import { estimateTrainingProgress, TrainingProgressEstimate } from '@/lib/trainingProgress';

interface TrainingLauncherPageProps {
    projectPath?: string | null;
}

type MiniMaxValidationKey =
    | 'validation.minimax_required_paths'
    | 'validation.minimax_batch_size'
    | 'validation.minimax_blocks_to_swap'
    | 'validation.minimax_shift'
    | 'validation.invalid_video_clip_mode';

type TomlRecord = Record<string, unknown>;

const isTomlRecord = (value: unknown): value is TomlRecord => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
);

const isBatchSizeOne = (value: unknown): boolean => {
    if (value === undefined || value === null || value === '') return true;
    if (Array.isArray(value)) {
        return value.every((entry) => Array.isArray(entry) && Number(entry[1]) === 1);
    }
    return Number(value) === 1;
};

const validateMiniMaxH3Config = (configValue: unknown): MiniMaxValidationKey | null => {
    if (!isTomlRecord(configValue)) return null;

    const modelValue = configValue.model;
    if (!isTomlRecord(modelValue)) return null;

    const config = configValue;
    const model = modelValue;
    if (model.type !== 'minimax_h3') return null;

    const textEncoders = model.text_encoders;
    const firstTextEncoder = Array.isArray(textEncoders) ? textEncoders[0] : undefined;
    const textEncoderPath = isTomlRecord(firstTextEncoder) ? firstTextEncoder.path : undefined;
    const requiredPaths = [model.diffusion_model, model.vae, model.audio_vae, textEncoderPath];
    if (requiredPaths.some((value) => typeof value !== 'string' || value.trim() === '')) {
        return 'validation.minimax_required_paths';
    }

    const batchSizeKeys = [
        'micro_batch_size_per_gpu',
        'image_micro_batch_size_per_gpu',
        'eval_micro_batch_size_per_gpu',
        'eval_image_micro_batch_size_per_gpu'
    ];
    if (batchSizeKeys.some((key) => !isBatchSizeOne(config[key]))) {
        return 'validation.minimax_batch_size';
    }

    const blocksToSwap = Number(config.blocks_to_swap ?? 0);
    if (!Number.isFinite(blocksToSwap) || blocksToSwap < 0 || blocksToSwap > 48) {
        return 'validation.minimax_blocks_to_swap';
    }

    const shift = Number(model.shift);
    if (!Number.isFinite(shift) || shift <= 0) {
        return 'validation.minimax_shift';
    }

    const videoClipMode = config.video_clip_mode ?? 'single_beginning';
    if (videoClipMode !== 'single_beginning' && videoClipMode !== 'single_middle') {
        return 'validation.invalid_video_clip_mode';
    }

    return null;
};

export function TrainingLauncherPage({ projectPath }: TrainingLauncherPageProps) {
    const { t } = useTranslation();
    const { showToast } = useGlassToast();
    const [isTraining, setIsTraining] = useState(false);
    const [startParams, setStartParams] = useState({
        resume_from_checkpoint: '',
        regenerate_cache: false,
        trust_cache: false,
        cache_only: false,
        reset_dataloader: false,
        reset_optimizer_params: false,
        i_know_what_i_am_doing: false,
        dump_dataset: '',
        num_gpus: 1
    });
    const [isLoaded, setIsLoaded] = useState(false);
    const [configSummary, setConfigSummary] = useState<{
        model_type: string;
        epochs: number;
        output_dir: string;
        max_steps?: number;
    } | null>(null);
    const [progressEstimate, setProgressEstimate] = useState<TrainingProgressEstimate | null>(null);

    // Initial check for training status and status updates
    useEffect(() => {
        const checkStatus = async () => {
            const status = await ipc.invoke('get-training-status');
            setIsTraining(status.running);
        };
        checkStatus();

        const handleStatus = (_event: any, status: any) => {
            if (typeof status.running === 'boolean') {
                setIsTraining(status.running);
                return;
            }
            if (status.type === 'started') setIsTraining(true);
            if (status.type === 'finished' || status.type === 'error') setIsTraining(false);
        };

        const removeStatus = (ipc as any).on('training-status', handleStatus);
        return () => {
            removeStatus();
        };
    }, []);

    useEffect(() => {
        if (!isTraining) return;

        const timer = setInterval(async () => {
            try {
                const status = await ipc.invoke('get-training-status');
                if (!status.running) setIsTraining(false);
            } catch (e) {
                console.error("Failed to refresh training status:", e);
            }
        }, 3000);

        return () => clearInterval(timer);
    }, [isTraining]);

    // Load saved launcher params for this project
    useEffect(() => {
        const loadParams = async () => {
            if (!projectPath) {
                setIsLoaded(false);
                return;
            }
            try {
                const savedParams = await ipc.invoke('get-project-launch-params', projectPath);
                if (savedParams && Object.keys(savedParams).length > 0) {
                    setStartParams(prev => ({
                        ...prev,
                        ...savedParams
                    }));
                } else {
                    // Reset to defaults if no saved params for this project
                    setStartParams({
                        resume_from_checkpoint: '',
                        regenerate_cache: false,
                        trust_cache: false,
                        cache_only: false,
                        reset_dataloader: false,
                        reset_optimizer_params: false,
                        i_know_what_i_am_doing: false,
                        dump_dataset: '',
                        num_gpus: 1
                    });
                }
                setIsLoaded(true);
            } catch (e) {
                console.error("Failed to load project launcher params:", e);
                setIsLoaded(true); // Still mark as loaded to allow editing
            }
        };
        loadParams();
    }, [projectPath]);

    // Save launcher params when changed (debounced)
    useEffect(() => {
        if (!isLoaded || !projectPath) return;

        const timer = setTimeout(() => {
            ipc.invoke('save-project-launch-params', {
                projectPath,
                params: startParams
            });
        }, 1000);

        return () => clearTimeout(timer);
    }, [startParams, projectPath, isLoaded]);

    // Load current config for summary and to ensure paths exist
    useEffect(() => {
        const loadConfig = async () => {
            if (!projectPath) return;
            const configPath = `${projectPath}/trainconfig.toml`;
            try {
                const content = await ipc.invoke('read-file', configPath);
                if (content) {
                    const parsed = parse(content) as any;
                    let outputDir = parsed.output_dir || '';
                    if (outputDir && !outputDir.includes(':') && !outputDir.startsWith('/') && !outputDir.startsWith('\\')) {
                        // Resolve relative path to projectRoot
                        outputDir = `${projectPath}/${outputDir}`;
                    }

                    setConfigSummary({
                        model_type: parsed.model_type || parsed.model?.type || 'unknown',
                        epochs: parsed.epochs || 0,
                        output_dir: outputDir,
                        max_steps: Number(parsed.max_steps) > 0 ? Number(parsed.max_steps) : undefined
                    });

                    const estimate = await estimateTrainingProgress(projectPath, parsed, startParams.num_gpus);
                    setProgressEstimate(estimate);
                }
            } catch (e) {
                console.error("Failed to load config summary:", e);
                setProgressEstimate(null);
            }
        };
        loadConfig();
    }, [projectPath, startParams.num_gpus]);

    const handleStartTraining = async () => {
        if (!projectPath) {
            showToast(t('common.no_project_selected'), 'error');
            return;
        }

        try {
            if (isTraining) {
                const stop = await ipc.invoke('stop-training');
                if (stop.success) {
                    setIsTraining(false);
                    showToast(t('training.training_stopped'), 'success');
                } else {
                    showToast(t('training.failed_stop'), 'error');
                }
                return;
            }

            const configPath = `${projectPath}/trainconfig.toml`;
            const configContent = await ipc.invoke('read-file', configPath);
            const parsedConfig = parse(configContent);
            const miniMaxValidationError = validateMiniMaxH3Config(parsedConfig);
            if (miniMaxValidationError) {
                showToast(t(miniMaxValidationError), 'error');
                return;
            }

            setIsTraining(true);

            const results = await ipc.invoke('start-training', {
                configPath: configPath,
                ...startParams
            });

            if (results.success) {
                showToast(t('training.training_started'), 'success');
            } else {
                setIsTraining(false);
                showToast(results.message || 'Failed to start', 'error');
            }
        } catch (e) {
            setIsTraining(false);
            console.error("Error starting training:", e);
            showToast("Error starting training", 'error');
        }
    };

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            {/* Action Header */}
            <header className="flex items-center justify-between">
                <div>
                    <h2 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-indigo-600 to-purple-600 dark:from-indigo-400 dark:to-purple-400 text-shadow-glow">
                        {t('nav.training_run')}
                    </h2>
                    <p className="text-muted-foreground mt-1">
                        {t('training.launcher_desc') || 'Quick launch training with runtime overrides.'}
                    </p>
                </div>

                <GlassButton
                    onClick={handleStartTraining}
                    className={cn(
                        "px-8 h-12 text-lg font-bold text-white border-none shadow-xl transition-all duration-500 hover:scale-105 active:scale-95",
                        isTraining
                            ? "bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-700 hover:to-orange-700 shadow-red-500/20"
                            : "bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 shadow-indigo-500/20"
                    )}
                >
                    {isTraining ? <Square className="w-5 h-5 mr-2 fill-current" /> : <Play className="w-5 h-5 mr-2 fill-current" />}
                    {isTraining ? t('training.stop') : t('training.start')}
                </GlassButton>
            </header>

            <div className="grid gap-6 md:grid-cols-3">
                {/* Configuration Summary */}
                <GlassCard className="p-6 md:col-span-1 flex flex-col">
                    <div className="flex items-center gap-2 mb-4">
                        <Settings className="w-5 h-5 text-indigo-500" />
                        <h3 className="text-lg font-bold">{t('training.config_summary') || 'Config Summary'}</h3>
                    </div>
                    {configSummary ? (
                        <div className="space-y-4 flex-1">
                            <div className="bg-white/5 p-3 rounded-xl border border-white/10">
                                <p className="text-xs uppercase tracking-wider text-muted-foreground font-bold mb-1">{t('model.type')}</p>
                                <p className="text-sm font-mono truncate">{configSummary.model_type}</p>
                            </div>
                            <div className="bg-white/5 p-3 rounded-xl border border-white/10">
                                <p className="text-xs uppercase tracking-wider text-muted-foreground font-bold mb-1">{t('training.epochs')}</p>
                                <p className="text-lg font-bold">{configSummary.epochs}</p>
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                <div className="bg-white/5 p-3 rounded-xl border border-white/10">
                                    <p className="text-xs uppercase tracking-wider text-muted-foreground font-bold mb-1">总步数</p>
                                    <p className="text-lg font-bold">
                                        {progressEstimate?.totalSteps ? progressEstimate.totalSteps.toLocaleString() : '--'}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground mt-1">
                                        {progressEstimate?.source === 'max_steps' ? '来自 max_steps' : progressEstimate?.source === 'dataset_estimate' ? '估算' : '等待配置'}
                                    </p>
                                </div>
                                <div className="bg-white/5 p-3 rounded-xl border border-white/10">
                                    <p className="text-xs uppercase tracking-wider text-muted-foreground font-bold mb-1">样本数</p>
                                    <p className="text-lg font-bold">
                                        {progressEstimate?.sampleCount !== null && progressEstimate?.sampleCount !== undefined ? progressEstimate.sampleCount.toLocaleString() : '--'}
                                    </p>
                                    <p className="text-[10px] text-muted-foreground mt-1">
                                        {progressEstimate?.sampleCount !== null && progressEstimate?.sampleCount !== undefined
                                            ? `图片 ${progressEstimate.imageCount ?? 0} / 视频 ${progressEstimate.videoCount ?? 0}`
                                            : progressEstimate?.reason || 'max_steps 模式'}
                                    </p>
                                </div>
                            </div>
                            <button
                                onClick={async () => {
                                    if (!configSummary?.output_dir) return;
                                    console.log("[Launcher] Requesting to open folder:", configSummary.output_dir);
                                    const success = await ipc.invoke('open-folder', configSummary.output_dir);
                                    console.log("[Launcher] Open folder result:", success);
                                    if (!success) {
                                        showToast(`Failed to open: ${configSummary.output_dir}`, 'error');
                                    }
                                }}
                                className="w-full text-left bg-white/5 hover:bg-white/10 p-3 rounded-xl border border-white/10 transition-colors group"
                                title={t('common.open_folder') || 'Open Folder'}
                            >
                                <div className="flex items-center justify-between mb-1">
                                    <p className="text-xs uppercase tracking-wider text-muted-foreground font-bold">{t('training.output_dir')}</p>
                                    <FolderOpen className="w-3 h-3 text-muted-foreground group-hover:text-indigo-400 transition-colors" />
                                </div>
                                <p className="text-xs truncate text-muted-foreground group-hover:text-foreground transition-colors">{configSummary.output_dir || 'Default'}</p>
                            </button>
                            <p className="text-xs text-muted-foreground italic mt-auto pt-4 border-t border-white/5">
                                * {t('training.setup_hint') || 'Modify these in Training Setup tab.'}
                            </p>
                        </div>
                    ) : (
                        <div className="flex items-center justify-center p-8 text-muted-foreground italic text-sm">
                            {t('training.no_config_loaded') || 'No configuration loaded'}
                        </div>
                    )}
                </GlassCard>

                {/* Launcher Params */}
                <div className="md:col-span-2">
                    <StartParamsConfig data={startParams} onChange={setStartParams} />
                </div>
            </div>

            {/* Integrated Training Logs */}
            <TrainingLogViewer projectPath={projectPath} showTitle={true} integrated={true} expectedTotalSteps={progressEstimate?.totalSteps ?? null} />
        </div>
    );
}
