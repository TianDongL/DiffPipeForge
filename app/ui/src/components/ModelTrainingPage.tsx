import { useState, useEffect } from "react";
import { GlassButton } from "./ui/GlassButton";
import { Save, RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { GlassConfirmDialog } from "./ui/GlassConfirmDialog";
import { useGlassToast } from "./ui/GlassToast";
import { ModelConfig } from "./ModelConfig";
import { TrainingConfig } from "./TrainingConfig";
import { AdvancedTrainingConfig } from "./AdvancedTrainingConfig";
import { OptimizerConfig } from "./OptimizerConfig";
import { AdapterConfig } from "./AdapterConfig";
import { MonitoringConfig } from "./MonitoringConfig";

interface ModelTrainingPageProps {
    importedConfig?: any;
    globalModelType?: string;
    setGlobalModelType?: (type: string) => void;
    setGlobalModelVersion?: (version: string) => void;
    evalSets?: { name: string, path: string }[];
    projectPath?: string | null;
}

// Default constants
const DEFAULT_MODEL_DATA = {
    model_type: 'sdxl',
    checkpoint_path: '',
    dtype: 'bfloat16'
};
const DEFAULT_TRAINING_DATA = {
    output_folder_name: 'mylora',
    epochs: 50,
    micro_batch_size_per_gpu: 1,
    gradient_accumulation_steps: 3,
    warmup_steps: 500,
    lr_scheduler: 'linear',
    gradient_clipping: 1.0,
    save_dtype: 'bfloat16',
    partition_method: 'parameters',
    activation_checkpointing: 'true',
    pipeline_stages: 1,
    blocks_to_swap: 0,
    caching_batch_size: 1,
    video_clip_mode: 'none',
    steps_per_print: 1,
    save_every_n_epochs: 1,
    checkpoint_every_n_minutes: 120,
    eval_every_n_epochs: 1,
    eval_every_n_steps: 0,
    eval_micro_batch_size_per_gpu: 1,
    eval_gradient_accumulation_steps: 1,
    eval_before_first_step: false,
    disable_block_swap_for_eval: false
};
const DEFAULT_ADVANCED_DATA = {
    compile: false,
    x_axis_examples: false,
    reentrant_activation_checkpointing: false
};
const DEFAULT_OPTIMIZER_DATA = {
    optimizer_type: 'adamw_optimi',
    lr: '2e-5',
    weight_decay: '0.01',
    beta1: '0.9',
    beta2: '0.99',
    eps: '1e-8'
};
const DEFAULT_ADAPTER_DATA = {
    adapter_type: 'lora',
    rank: 32,
    dtype: 'bfloat16'
};
const DEFAULT_MONITORING_DATA = {
    enable_wandb: false,
    wandb_api_key: '',
    wandb_tracker_name: '',
    wandb_run_name: ''
};

export function ModelTrainingPage({
    importedConfig,
    globalModelType,
    setGlobalModelType,
    setGlobalModelVersion,
    evalSets = [],
    projectPath
}: ModelTrainingPageProps) {
    const { t } = useTranslation();
    const { showToast } = useGlassToast();
    const [modelData, setModelData] = useState<any>(DEFAULT_MODEL_DATA);
    const [trainingData, setTrainingData] = useState<any>(DEFAULT_TRAINING_DATA);
    const [advancedData, setAdvancedData] = useState<any>(DEFAULT_ADVANCED_DATA);
    const [optimizerData, setOptimizerData] = useState<any>(DEFAULT_OPTIMIZER_DATA);
    const [adapterData, setAdapterData] = useState<any>(DEFAULT_ADAPTER_DATA);
    const [monitoringData, setMonitoringData] = useState<any>(DEFAULT_MONITORING_DATA);
    const [resetKey, setResetKey] = useState(0);
    const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);


    // Sync global model type to local state if provided
    useEffect(() => {
        if (globalModelType && globalModelType !== modelData.model_type) {
            setModelData((prev: any) => ({ ...prev, model_type: globalModelType }));
        }
    }, [globalModelType]);

    // Update global model type and version when local changes
    const handleModelDataChange = (newData: any) => {
        setModelData(newData);
        if (setGlobalModelType && newData.model_type && newData.model_type !== globalModelType) {
            setGlobalModelType(newData.model_type);
        }
        if (setGlobalModelVersion && newData.model_version) {
            setGlobalModelVersion(newData.model_version);
        }
    };

    // Effect to handle imported configuration
    useEffect(() => {
        if (importedConfig) {
            console.log("Importing Training Config:", importedConfig);

            // 1. Map Model Data
            if (importedConfig.model) {
                const m = importedConfig.model;
                let mType = m.type;
                // Backend type mapping fix
                if (mType === 'hunyuan-video') mType = 'hunyuan_video';
                if (mType === 'ltx-video') mType = 'ltx_video';
                if (mType === 'lumina_2') mType = 'lumina2';

                const mappedModel: any = {
                    ...m,
                    model_type: mType,
                    // Map back paths that might be under different names
                    vae_path: m.vae_path || m.vae,
                    diffusion_path: m.diffusion_model || m.diffusion_path || m.diffusers_path || m.checkpoint_path,
                    v_pred: !!m.v_pred,
                    debiased_estimation_loss: !!m.debiased_estimation_loss,
                    min_snr_gamma: m.min_snr_gamma ?? importedConfig.min_snr_gamma,
                    flux_shift: m.flux_shift !== undefined ? m.flux_shift : m.shift
                };

                // Sync global type on import
                if (setGlobalModelType && m.type) {
                    setGlobalModelType(m.type);
                }

                // Handle text encoders (list or single)
                if (Array.isArray(m.text_encoders) && m.text_encoders.length > 0) {
                    const firstTE = m.text_encoders[0];
                    if (Array.isArray(firstTE.paths)) {
                        mappedModel.text_encoder_path = firstTE.paths[0];
                        mappedModel.byt5_path = firstTE.paths[1];
                    } else if (firstTE.path) {
                        mappedModel.text_encoder_path = firstTE.path;
                        mappedModel.text_encoder = firstTE.path;
                        mappedModel.Text_Encoder = firstTE.path;
                    }
                }

                // Guess wan version if type is generic 'wan'
                if (m.type === 'wan') {
                    if (m.ckpt_path?.toLowerCase().includes('2.2')) {
                        mappedModel.model_type = 'wan22';
                    } else {
                        mappedModel.model_type = 'wan21';
                    }
                }

                console.log("Mapped Model Data:", mappedModel);
                setModelData((prev: any) => ({ ...prev, ...mappedModel }));
            } else if (importedConfig.model_arguments) {
                // Fallback to old simpletuner style if supported
                setModelData(importedConfig.model_arguments);
            }

            // 2. Map Optimizer Data
            if (importedConfig.optimizer) {
                const o = importedConfig.optimizer;
                const mappedOpt: any = {
                    optimizer_type: o.type,
                    lr: o.lr,
                    weight_decay: o.weight_decay,
                    eps: o.eps
                };
                if (Array.isArray(o.betas) && o.betas.length >= 2) {
                    mappedOpt.beta1 = o.betas[0];
                    mappedOpt.beta2 = o.betas[1];
                }
                setOptimizerData((prev: any) => ({ ...prev, ...mappedOpt }));
            } else if (importedConfig.optimizer_arguments) {
                setOptimizerData(importedConfig.optimizer_arguments);
            }

            // 3. Map Adapter Data
            if (importedConfig.adapter) {
                const a = importedConfig.adapter;
                setAdapterData((prev: any) => ({
                    ...prev,
                    adapter_type: a.type,
                    rank: a.rank,
                    dtype: a.dtype,
                    init_from_existing: a.init_from_existing
                }));
            } else if (importedConfig.adapter_arguments) {
                setAdapterData(importedConfig.adapter_arguments);
            }

            // 4. Map Training Data (Top-level fields)
            const tData: any = {};
            const trainKeys = [
                'epochs', 'micro_batch_size_per_gpu', 'gradient_accumulation_steps',
                'warmup_steps', 'output_dir', 'save_dtype', 'partition_method',
                'activation_checkpointing', 'pipeline_stages', 'blocks_to_swap',
                'caching_batch_size', 'save_every_n_epochs', 'checkpoint_every_n_minutes',
                'disable_block_swap_for_eval', 'gradient_clipping', 'lr_scheduler',
                'save_every_n_steps', 'eval_every_n_steps',
                'checkpoint_every_n_epochs', 'max_steps',
                // Added missing keys
                'video_clip_mode', 'eval_micro_batch_size_per_gpu', 'eval_gradient_accumulation_steps',
                'eval_every_n_epochs', 'eval_before_first_step', 'pseudo_huber_c',
                'map_num_proc', 'steps_per_print', 'force_constant_lr'
            ];

            trainKeys.forEach(key => {
                if (importedConfig[key] !== undefined) {
                    if (key === 'output_dir') {
                        const fullPath = String(importedConfig[key]).replace(/\\/g, '/');
                        const segments = fullPath.split('/').filter(Boolean);
                        let basename = segments.pop() || 'mylora';

                        tData.output_folder_name = basename;
                    } else if (key === 'activation_checkpointing') {
                        tData[key] = String(importedConfig[key]);
                    } else {
                        tData[key] = importedConfig[key];
                    }
                }
            });

            if (Object.keys(tData).length > 0) {
                setTrainingData((prev: any) => ({ ...prev, ...tData }));
            } else if (importedConfig.training_arguments) {
                setTrainingData(importedConfig.training_arguments);
            }

            // Advanced data could be mixed in top-level
            const advUpdate: any = {};
            if (importedConfig.min_snr_gamma !== undefined) advUpdate.min_snr_gamma = importedConfig.min_snr_gamma;
            if (importedConfig.compile !== undefined) advUpdate.compile = importedConfig.compile;
            if (importedConfig.x_axis_examples !== undefined) advUpdate.x_axis_examples = importedConfig.x_axis_examples;
            if (importedConfig.reentrant_activation_checkpointing !== undefined) advUpdate.reentrant_activation_checkpointing = importedConfig.reentrant_activation_checkpointing;

            if (Object.keys(advUpdate).length > 0) {
                setAdvancedData((prev: any) => ({ ...prev, ...advUpdate }));
            }

            // 6. Map Monitoring Data
            if (importedConfig.monitoring) {
                const mon = importedConfig.monitoring;
                setMonitoringData((prev: any) => ({
                    ...prev,
                    enable_wandb: mon.enable_wandb,
                    wandb_api_key: mon.wandb_api_key,
                    wandb_tracker_name: mon.wandb_tracker_name,
                    wandb_run_name: mon.wandb_run_name
                }));
            }
        }
    }, [importedConfig]);

    // State for auto-save debounce
    const [saveTimeout, setSaveTimeout] = useState<NodeJS.Timeout | null>(null);
    // Cached session folder (created once per session/mount to avoid new folders every save)
    const [sessionFolder, setSessionFolder] = useState<string | null>(projectPath ? projectPath.replace(/\\/g, '/') : null);

    // Update sessionFolder if projectPath prop changes
    useEffect(() => {
        if (projectPath) {
            setSessionFolder(projectPath.replace(/\\/g, '/'));
        }
    }, [projectPath]);
    // Cached actual saved paths (to ensure consistency with what was actually saved)
    const [savedPaths, setSavedPaths] = useState<{
        trainConfigPath: string | null;
        datasetPath: string | null;
        evalDatasetPath: string | null;
    }>({ trainConfigPath: null, datasetPath: null, evalDatasetPath: null });

    // Generate timestamp folder on first access
    const getOrCreateSessionFolder = async () => {
        // 1. Priority: Existing session folder already in state
        if (sessionFolder) return sessionFolder;

        // 2. Priority: Inherited project path from Layout (e.g. if we loaded an existing project)
        if (projectPath) {
            const normalized = projectPath.replace(/\\/g, '/');
            setSessionFolder(normalized);
            return normalized;
        }

        // 3. Fallback: Generate a new timestamped folder
        const { projectRoot } = await window.ipcRenderer.invoke('get-paths');
        const now = new Date();
        const pad = (n: number) => n.toString().padStart(2, '0');
        const timestamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getSeconds())}`;
        const folder = `${projectRoot}/output/${timestamp}`.replace(/\\/g, '/');
        setSessionFolder(folder);
        return folder;
    };

    const constructConfig = async () => {
        const dateDir = await getOrCreateSessionFolder();

        // Use saved paths if available, otherwise build them (for backwards compatibility)
        const trainConfigPath = savedPaths.trainConfigPath || `${dateDir}/trainconfig.toml`;
        const datasetPath = savedPaths.datasetPath || `${dateDir}/dataset.toml`;
        const evalDatasetPath = savedPaths.evalDatasetPath || `${dateDir}/evaldataset.toml`;

        const finalOutputDir = `${dateDir}/${trainingData.output_folder_name || 'mylora'}`;

        const fullConfig = {
            ...trainingData,
            ...advancedData,
            model: modelData,
            optimizer: optimizerData,
            adapter: adapterData,
            monitoring: monitoringData,
            dataset: datasetPath,
            eval_datasets: evalSets.map((set, idx) => ({
                name: set.name || `validation_set_${idx}`,
                config: idx === 0 ? evalDatasetPath : `${dateDir}/evaldataset_${idx}.toml`
            })),
            output_dir: finalOutputDir
        };

        // Remove undefined/empty/zero numericals for cleanliness (except specific keys)
        Object.keys(fullConfig).forEach(key => {
            const val = fullConfig[key];
            if (val === undefined || val === '') {
                delete fullConfig[key];
                return;
            }

            // For advanced params (defaults were 0 or false), if they are 0/false, remove them
            // partition_split is a string, so it won't be caught by === 0 check
            if (val === 0 || val === false || val === '0' || val === 'false') {
                // Keep some keys that might authentically be 0? 
                // Currently user wants to "filter out if set back to 0".
                // We know these keys started as undefined or 0 in advancedData.
                // Safest to list the keys we definitely want to drop if 0.
                const optionalZeroKeys = [
                    'max_steps', 'force_constant_lr', 'pseudo_huber_c',
                    'map_num_proc', 'save_every_n_steps', 'eval_every_n_steps',
                    'checkpoint_every_n_epochs', 'blocks_to_swap'
                ];

                if (optionalZeroKeys.includes(key)) {
                    delete fullConfig[key];
                }

                // Also drop the boolean flags if false
                if (['compile', 'x_axis_examples', 'reentrant_activation_checkpointing'].includes(key)) {
                    delete fullConfig[key];
                }
            }
        });

        // Ensure eval_datasets is removed if empty
        if (fullConfig.eval_datasets && fullConfig.eval_datasets.length === 0) {
            delete fullConfig.eval_datasets;
            // Also cleanup other eval params to keep config clean
            Object.keys(fullConfig).forEach(key => {
                if (key.startsWith('eval_') || key === 'disable_block_swap_for_eval') {
                    delete fullConfig[key];
                }
            });
        }

        // Prune redundant parameters for non-video models
        const isVideoModel = ['hunyuan_video', 'ltx_video', 'wan21', 'wan22', 'hunyuan_video_15', 'cosmos'].includes(modelData.model_type || '');
        if (!isVideoModel) {
            delete fullConfig.video_clip_mode;
        }

        return { fullConfig, trainConfigPath, datasetPath, evalDatasetPath };
    };

    const validate = (): { valid: boolean; message?: string } => {
        // 移除输出目录名的非空强校验，允许用户保存中间状态

        // 2. Training params (epochs, batch size, grad accumulation)
        if (trainingData.epochs !== undefined) {
            const epochs = Number(trainingData.epochs);
            if (isNaN(epochs) || epochs <= 0) return { valid: false, message: t('validation.invalid_integer') };
        }
        if (trainingData.micro_batch_size_per_gpu !== undefined) {
            const batchSize = Number(trainingData.micro_batch_size_per_gpu);
            if (isNaN(batchSize) || batchSize <= 0) return { valid: false, message: t('validation.invalid_integer') };
        }
        if (trainingData.gradient_accumulation_steps !== undefined) {
            const gradAcc = Number(trainingData.gradient_accumulation_steps);
            if (isNaN(gradAcc) || gradAcc <= 0) return { valid: false, message: t('validation.invalid_integer') };
        }
        if (trainingData.blocks_to_swap !== undefined) {
            const bts = Number(trainingData.blocks_to_swap);
            if (isNaN(bts) || bts < 0) return { valid: false, message: t('validation.invalid_number') };
        }
        if (trainingData.caching_batch_size !== undefined) {
            const cbs = Number(trainingData.caching_batch_size);
            if (isNaN(cbs) || cbs <= 0) return { valid: false, message: t('validation.invalid_integer') };
        }

        // 3. Warmup steps
        if (trainingData.warmup_steps !== undefined) {
            const warmup = Number(trainingData.warmup_steps);
            if (isNaN(warmup) || warmup < 0) return { valid: false, message: t('validation.invalid_number') };
        }

        return { valid: true };
    };

    const handleSaveConfig = async (silent = false) => {
        // Validate before saving
        const { valid, message } = validate();
        if (!valid) {
            if (!silent) {
                showToast(message || 'Invalid input', 'error');
            }
            return;
        }

        try {
            const { fullConfig } = await constructConfig();

            const formatValue = (v: any): string => {
                if (v === 'true' || v === true) return 'true';
                if (v === 'false' || v === false) return 'false';
                if (v === undefined || v === null) return '';

                if (typeof v === 'string') {
                    const trimmed = v.trim();
                    // 检查是否是合法的数值字符串（排除路径）
                    if (trimmed !== '' && !v.includes('/') && !v.includes('\\')) {
                        const n = Number(trimmed);
                        if (!isNaN(n)) {
                            // 如果用户输入了科学计数法，直接保留
                            if (trimmed.toLowerCase().includes('e')) {
                                return trimmed;
                            }
                            if (Number.isInteger(n)) return `${n}.0`;
                            // Fix floating point noise for strings as well
                            const normalized = parseFloat(n.toFixed(10));
                            if (Number.isInteger(normalized)) return `${normalized}.0`;
                            return normalized.toString();
                        }
                    }
                    return `'${v}'`;
                }

                if (typeof v === 'number') {
                    if (Number.isInteger(v)) return `${v}.0`;
                    // Fix floating point noise (e.g. 0.9899999999999999 -> 0.99)
                    const normalized = parseFloat(v.toFixed(10));
                    if (Number.isInteger(normalized)) return `${normalized}.0`;

                    // 对于非常小的数值，使用科学计数法
                    if (Math.abs(normalized) < 1e-4 && normalized !== 0) {
                        return normalized.toExponential();
                    }
                    return normalized.toString();
                }

                if (Array.isArray(v)) {
                    return `[${v.map(formatValue).join(', ')}]`;
                }
                if (typeof v === 'object' && v !== null) {
                    const entries = Object.entries(v).map(([key, val]) => `${key} = ${formatValue(val)}`).join(', ');
                    return `{ ${entries} }`;
                }
                return `'${v}'`;
            };

            const lines: string[] = [];

            // Top level fields
            const topLevelKeys = [
                'epochs', 'micro_batch_size_per_gpu', 'gradient_accumulation_steps', 'warmup_steps',
                'output_dir', 'dataset', 'eval_datasets', 'save_dtype', 'partition_method', 'activation_checkpointing',
                'pipeline_stages', 'blocks_to_swap', 'caching_batch_size', 'save_every_n_epochs',
                'checkpoint_every_n_minutes', 'gradient_clipping', 'lr_scheduler', 'min_snr_gamma',
                'max_steps', 'force_constant_lr', 'pseudo_huber_c', 'map_num_proc', 'steps_per_print',
                'compile', 'x_axis_examples', 'reentrant_activation_checkpointing',
                'save_every_n_steps', 'eval_every_n_steps', 'checkpoint_every_n_epochs',
                'partition_split', 'video_clip_mode', 'eval_micro_batch_size_per_gpu',
                'eval_gradient_accumulation_steps', 'eval_every_n_epochs', 'eval_before_first_step',
                'disable_block_swap_for_eval', 'image_micro_batch_size_per_gpu',
                'image_eval_micro_batch_size_per_gpu'
            ];

            const integerKeys = new Set([
                'epochs', 'micro_batch_size_per_gpu', 'gradient_accumulation_steps', 'warmup_steps',
                'blocks_to_swap', 'caching_batch_size', 'save_every_n_epochs', 'save_every_n_steps',
                'eval_every_n_epochs', 'eval_every_n_steps', 'checkpoint_every_n_epochs',
                'checkpoint_every_n_minutes', 'pipeline_stages', 'map_num_proc', 'steps_per_print',
                'max_steps', 'image_micro_batch_size_per_gpu', 'image_eval_micro_batch_size_per_gpu',
                'eval_micro_batch_size_per_gpu', 'eval_gradient_accumulation_steps'
            ]);

            topLevelKeys.forEach(key => {
                if (fullConfig[key] !== undefined) {
                    let value = fullConfig[key];
                    if (integerKeys.has(key)) {
                        const n = Number(value);
                        if (!isNaN(n)) {
                            lines.push(`${key} = ${Math.round(n)}`);
                            return;
                        }
                    }
                    lines.push(`${key} = ${formatValue(value)}`);
                }
            });

            // Model section
            if (fullConfig.model) {
                const m = fullConfig.model;
                lines.push('\n[model]');

                // Map UI types to backend types
                let backendType = m.model_type;
                switch (m.model_type) {
                    case 'flux_kontext': backendType = 'flux'; break;
                    case 'wan21':
                    case 'wan22': backendType = 'wan'; break;
                    case 'ltx_video': backendType = 'ltx-video'; break;
                    case 'hunyuan_video': backendType = 'hunyuan-video'; break;
                    case 'lumina2': backendType = 'lumina_2'; break;
                }

                lines.push(`type = '${backendType}'`);

                // Common fields across many models
                if (m.dtype) lines.push(`dtype = '${m.dtype}'`);

                // Model-specific path and parameter logic
                switch (m.model_type) {
                    case 'sdxl':
                        if (m.checkpoint_path) lines.push(`checkpoint_path = '${m.checkpoint_path.replace(/\\/g, '/')}'`);
                        lines.push(`unet_lr = ${formatValue(m.unet_lr || 4e-5)}`);
                        lines.push(`text_encoder_1_lr = ${formatValue(m.text_encoder_1_lr || 2e-5)}`);
                        lines.push(`text_encoder_2_lr = ${formatValue(m.text_encoder_2_lr || 2e-5)}`);
                        if (m.min_snr_gamma !== undefined && m.min_snr_gamma !== '') {
                            lines.push(`min_snr_gamma = ${formatValue(m.min_snr_gamma)}`);
                        }
                        if (m.v_pred !== undefined && m.v_pred !== '') lines.push(`v_pred = ${m.v_pred}`);
                        if (m.debiased_estimation_loss !== undefined && m.debiased_estimation_loss !== '') {
                            lines.push(`debiased_estimation_loss = ${m.debiased_estimation_loss}`);
                        }
                        break;

                    case 'flux':
                    case 'flux_kontext':
                    case 'chroma':
                    case 'hidream':
                    case 'sd3':
                    case 'omnigen2':
                        lines.push(`diffusers_path = '${(m.diffusers_path || '').replace(/\\/g, '/')}'`);
                        lines.push(`transformer_path = '${(m.transformer_path || '').replace(/\\/g, '/')}'`);
                        lines.push(`flux_shift = ${m.flux_shift !== undefined ? m.flux_shift : (m.model_type === 'flux' || m.model_type === 'flux_kontext' || m.model_type === 'chroma')}`);
                        if (m.model_type === 'flux') {
                            lines.push(`bypass_guidance_embedding = ${m.bypass_guidance_embedding === true}`);
                        }
                        lines.push(`transformer_dtype = '${m.transformer_dtype || 'bfloat16'}'`);
                        if (m.model_type === 'hidream') {
                            lines.push(`llama3_path = '${(m.llama3_path || '').replace(/\\/g, '/')}'`);
                            lines.push(`llama3_4bit = ${m.llama3_4bit !== false}`);
                            lines.push(`max_llama3_sequence_length = ${Number(m.max_llama3_sequence_length || 128)}`);
                        }
                        break;

                    case 'ltx_video':
                        lines.push(`diffusers_path = '${(m.diffusers_path || '').replace(/\\/g, '/')}'`);
                        lines.push(`single_file_path = '${(m.single_file_path || '').replace(/\\/g, '/')}'`);
                        lines.push(`timestep_sample_method = '${m.timestep_sample_method || 'logit_normal'}'`);
                        lines.push(`first_frame_conditioning_p = ${formatValue(m.first_frame_conditioning_p || 1.0)}`);
                        break;

                    case 'hunyuan-video':
                    case 'hunyuan_video':
                        lines.push(`ckpt_path = '${(m.ckpt_path || '').replace(/\\/g, '/')}'`);
                        lines.push(`transformer_path = '${(m.transformer_path || '').replace(/\\/g, '/')}'`);
                        lines.push(`vae_path = '${(m.vae_path || '').replace(/\\/g, '/')}'`);
                        lines.push(`llm_path = '${(m.llm_path || '').replace(/\\/g, '/')}'`);
                        lines.push(`clip_path = '${(m.clip_path || '').replace(/\\/g, '/')}'`);
                        lines.push(`transformer_dtype = '${m.transformer_dtype || 'bfloat16'}'`);
                        lines.push(`timestep_sample_method = '${m.timestep_sample_method || 'logit_normal'}'`);
                        break;

                    case 'wan21':
                    case 'wan22':
                        // Backend type 'wan' is handled at the top
                        lines.push(`ckpt_path = '${(m.ckpt_path || '').replace(/\\/g, '/')}'`);
                        lines.push(`transformer_path = '${(m.transformer_path || '').replace(/\\/g, '/')}'`);
                        lines.push(`llm_path = '${(m.llm_path || '').replace(/\\/g, '/')}'`);
                        lines.push(`transformer_dtype = '${m.transformer_dtype || 'bfloat16'}'`);
                        lines.push(`timestep_sample_method = '${m.timestep_sample_method || 'logit_normal'}'`);
                        lines.push(`min_t = ${formatValue(m.min_t || 0.0)}`);
                        lines.push(`max_t = ${formatValue(m.max_t || 1.0)}`);
                        break;

                    case 'qwen_image':
                    case 'qwen2511':
                        if (m.diffusers_path) lines.push(`diffusers_path = '${(m.diffusers_path).replace(/\\/g, '/')}'`);
                        if (m.transformer_path) lines.push(`transformer_path = '${(m.transformer_path).replace(/\\/g, '/')}'`);
                        if (m.text_encoder_path) lines.push(`text_encoder_path = '${(m.text_encoder_path).replace(/\\/g, '/')}'`);
                        if (m.vae_path) lines.push(`vae_path = '${(m.vae_path).replace(/\\/g, '/')}'`);
                        lines.push(`transformer_dtype = '${m.transformer_dtype || 'float8'}'`);
                        if (m.timestep_sample_method) lines.push(`timestep_sample_method = '${m.timestep_sample_method}'`);
                        break;

                    case 'hunyuan_image':
                        lines.push(`transformer_path = '${(m.transformer_path || '').replace(/\\/g, '/')}'`);
                        lines.push(`vae_path = '${(m.vae_path || '').replace(/\\/g, '/')}'`);
                        lines.push(`text_encoder_path = '${(m.text_encoder_path || '').replace(/\\/g, '/')}'`);
                        lines.push(`byt5_path = '${(m.byt5_path || '').replace(/\\/g, '/')}'`);
                        lines.push(`transformer_dtype = '${m.transformer_dtype || 'float8'}'`);
                        break;

                    case 'cosmos':
                        lines.push(`transformer_path = '${(m.transformer_path || '').replace(/\\/g, '/')}'`);
                        lines.push(`vae_path = '${(m.vae_path || '').replace(/\\/g, '/')}'`);
                        lines.push(`text_encoder_path = '${(m.text_encoder_path || '').replace(/\\/g, '/')}'`);
                        break;

                    case 'cosmos_predict2':
                        lines.push(`transformer_path = '${(m.transformer_path || '').replace(/\\/g, '/')}'`);
                        lines.push(`vae_path = '${(m.vae_path || '').replace(/\\/g, '/')}'`);
                        lines.push(`t5_path = '${(m.t5_path || '').replace(/\\/g, '/')}'`);
                        if (m.transformer_dtype) lines.push(`transformer_dtype = '${m.transformer_dtype}'`);
                        break;

                    case 'lumina2':
                        lines.push(`transformer_path = '${(m.transformer_path || '').replace(/\\/g, '/')}'`);
                        lines.push(`llm_path = '${(m.llm_path || '').replace(/\\/g, '/')}'`);
                        lines.push(`vae_path = '${(m.vae_path || '').replace(/\\/g, '/')}'`);
                        lines.push(`lumina_shift = ${m.lumina_shift !== false}`);
                        break;

                    case 'auraflow':
                        lines.push(`transformer_path = '${(m.transformer_path || '').replace(/\\/g, '/')}'`);
                        lines.push(`text_encoder_path = '${(m.text_encoder_path || '').replace(/\\/g, '/')}'`);
                        lines.push(`vae_path = '${(m.vae_path || '').replace(/\\/g, '/')}'`);
                        lines.push(`transformer_dtype = '${m.transformer_dtype || 'float8'}'`);
                        lines.push(`max_sequence_length = ${Number(m.max_sequence_length || 768)}`);
                        lines.push(`timestep_sample_method = '${m.timestep_sample_method || 'logit_normal'}'`);
                        break;

                    case 'flux2':
                    case 'z_image':
                    case 'hunyuan_video_15':
                        lines.push(`diffusion_model = '${(m.diffusion_model ?? m.diffusion_path ?? '').replace(/\\/g, '/')}'`);
                        lines.push(`vae = '${(m.vae ?? m.vae_path ?? '').replace(/\\/g, '/')}'`);
                        lines.push(`shift = ${formatValue(m.shift || 1)}`);
                        lines.push(`diffusion_model_dtype = '${m.diffusion_model_dtype || m.transformer_dtype || 'bfloat16'}'`);
                        lines.push(`timestep_sample_method = '${m.timestep_sample_method || 'logit_normal'}'`);

                        const tePath = m.text_encoder_path ?? m.text_encoder ?? m.Text_Encoder ?? '';
                        const teType = m.model_type === 'z_image' ? 'lumina2' : (m.model_type === 'hunyuan_video_15' ? 'hunyuan_video_15' : 'flux2');

                        if (m.model_type === 'hunyuan_video_15') {
                            const b5Path = m.byt5_path || '';
                            lines.push(`text_encoders = [{ paths = ['${tePath.replace(/\\/g, '/')}', '${b5Path.replace(/\\/g, '/')}'], type = '${teType}' }]`);
                        } else {
                            lines.push(`text_encoders = [{ path = '${tePath.replace(/\\/g, '/')}', type = '${teType}' }]`);
                        }

                        if (m.merge_adapters) {
                            const adapters = Array.isArray(m.merge_adapters) ? m.merge_adapters : [m.merge_adapters];
                            lines.push(`merge_adapters = [${adapters.map((a: string) => `'${a.replace(/\\/g, '/')}'`).join(', ')}]`);
                        }
                        break;

                    default:
                        // Fallback for unknown types
                        Object.keys(m).forEach(key => {
                            if (key !== 'model_type') {
                                lines.push(`${key} = ${formatValue(m[key])}`);
                            }
                        });
                }
            }

            // Optimizer section
            if (fullConfig.optimizer) {
                const optType = fullConfig.optimizer.optimizer_type || 'adamw_optimi';
                lines.push('\n[optimizer]');
                lines.push(`type = '${optType}'`);

                if (optType === 'automagic') {
                    // For automagic, only keep weight_decay
                    lines.push(`weight_decay = ${formatValue(fullConfig.optimizer.weight_decay || '0.01')}`);
                } else {
                    const lr = optType === 'Prodigy' ? '1' : (fullConfig.optimizer.lr || '2e-5');
                    lines.push(`lr = ${formatValue(lr)}`);
                    lines.push(`weight_decay = ${formatValue(fullConfig.optimizer.weight_decay || '0.01')}`);
                    lines.push(`eps = ${formatValue(fullConfig.optimizer.eps || '1e-8')}`);

                    const beta1 = fullConfig.optimizer.beta1 || '0.9';
                    const beta2 = fullConfig.optimizer.beta2 || '0.99';
                    lines.push(`betas = [${formatValue(beta1)}, ${formatValue(beta2)}]`);

                    if (optType === 'AdamW8bitKahan' && fullConfig.optimizer.stabilize !== undefined) {
                        lines.push(`stabilize = ${fullConfig.optimizer.stabilize}`);
                    }
                }
            }

            // Adapter section
            const adapterType = fullConfig.adapter?.adapter_type || 'lora';
            if (adapterType !== 'none') {
                lines.push('\n[adapter]');
                lines.push(`type = '${adapterType}'`);
                // Need to provide defaults if values are missing from state
                const rank = fullConfig.adapter?.rank || 32;
                const dtype = fullConfig.adapter?.dtype || 'bfloat16';
                lines.push(`rank = ${Number(rank)}`);
                lines.push(`dtype = '${dtype}'`);

                if (fullConfig.adapter?.init_from_existing) {
                    lines.push(`init_from_existing = '${fullConfig.adapter.init_from_existing.replace(/\\/g, '\\\\')}'`);
                }
            }

            // Monitoring section
            if (fullConfig.monitoring && fullConfig.monitoring.enable_wandb) {
                lines.push('\n[monitoring]');
                lines.push(`enable_wandb = true`);
                lines.push(`wandb_api_key = '${fullConfig.monitoring.wandb_api_key || ''}'`);
                lines.push(`wandb_tracker_name = '${fullConfig.monitoring.wandb_tracker_name || ''}'`);
                lines.push(`wandb_run_name = '${fullConfig.monitoring.wandb_run_name || ''}'`);
            } else {
                lines.push('\n[monitoring]');
                lines.push(`enable_wandb = false`);
            }

            const tomlString = lines.join('\n');

            const result = await window.ipcRenderer.invoke('save-to-date-folder', {
                filename: 'trainconfig.toml',
                content: tomlString
            });

            if (result.success) {
                // Use backend returned folder/path for consistency
                if (result.folder) {
                    setSessionFolder(result.folder);
                }
                if (result.path) {
                    setSavedPaths(prev => ({
                        ...prev,
                        trainConfigPath: result.path
                    }));
                }
                if (!silent) {
                    showToast(t('common.config_saved'), 'success');
                }
            }
        } catch (e) {
            console.error("Failed to save config:", e);
            showToast('保存失败', 'error');
        }
    };

    // State for auto-save debounce
    useEffect(() => {
        if (saveTimeout) clearTimeout(saveTimeout);

        const timeout = setTimeout(() => {
            // Only auto-save if we have some meaningful data
            if (Object.keys(modelData).length > 0) {
                handleSaveConfig(true);
            }
        }, 1000); // 1s debounce

        setSaveTimeout(timeout);
        return () => clearTimeout(timeout);
    }, [modelData, trainingData, advancedData, optimizerData, adapterData, monitoringData, evalSets, sessionFolder]);


    const handleReset = () => {
        setModelData(DEFAULT_MODEL_DATA);
        setTrainingData(DEFAULT_TRAINING_DATA);
        setAdvancedData(DEFAULT_ADVANCED_DATA);
        setOptimizerData(DEFAULT_OPTIMIZER_DATA);
        setAdapterData(DEFAULT_ADAPTER_DATA);
        setMonitoringData(DEFAULT_MONITORING_DATA);
        setResetKey(prev => prev + 1);
        setIsResetDialogOpen(false);
    };


    return (
        <div
            className="space-y-6"
            onKeyDown={(e) => {
                if (e.key === 'Enter') {
                    handleSaveConfig(false);
                }
            }}
        >

            <ModelConfig key={`model-${resetKey}`} data={modelData} onChange={handleModelDataChange} />
            <TrainingConfig
                key={`training-${resetKey}`}
                data={trainingData}
                modelType={modelData.model_type}
                onChange={setTrainingData}
                validationEnabled={evalSets.length > 0}
            />
            <AdvancedTrainingConfig key={`advanced-${resetKey}`} data={advancedData} onChange={setAdvancedData} />
            <OptimizerConfig key={`optimizer-${resetKey}`} data={optimizerData} onChange={setOptimizerData} />
            <AdapterConfig key={`adapter-${resetKey}`} data={adapterData} onChange={setAdapterData} />
            <MonitoringConfig data={monitoringData} onChange={setMonitoringData} />

            <div className="flex justify-end gap-3 pt-4">
                <GlassButton variant="destructive" size="lg" onClick={() => setIsResetDialogOpen(true)}>
                    <RotateCcw className="w-4 h-4 mr-2" />
                    {t('common.reset_default')}
                </GlassButton>
                <GlassButton
                    onClick={() => handleSaveConfig(false)}
                    size="lg"
                    className="pl-6 pr-8 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white border-none shadow-lg shadow-indigo-500/20"
                    title={t('model_load.auto_save_tooltip')}
                >
                    <Save className="w-4 h-4 mr-2" />
                    {t('model_load.save')}
                </GlassButton>
            </div>

            <GlassConfirmDialog
                isOpen={isResetDialogOpen}
                onClose={() => setIsResetDialogOpen(false)}
                onConfirm={handleReset}
                title={t('common.confirm_reset_title')}
                description={t('common.confirm_reset_desc')}
                confirmText={t('common.confirm')}
                cancelText={t('common.cancel')}
            />
        </div >
    );
}
