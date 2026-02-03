import React, { useState, useEffect } from 'react';
import { GlassCard } from './ui/GlassCard';
import { GlassInput } from './ui/GlassInput';
import { GlassSelect } from './ui/GlassSelect';
import { useTranslation } from 'react-i18next';
import { FolderOpen } from 'lucide-react';
import { HelpIcon } from './ui/HelpIcon';

export interface ModelConfigProps {
    data: any;
    onChange: (data: any) => void;
}

// dtype options based on model type
const DTYPE_OPTIONS = [
    { label: 'bfloat16', value: 'bfloat16' },
    { label: 'float16', value: 'float16' },
    { label: 'float32', value: 'float32' }
];

const TRANSFORMER_DTYPE_OPTIONS = [
    { label: 'bfloat16', value: 'bfloat16' },
    { label: 'float8', value: 'float8' },
    { label: 'float8_e5m2', value: 'float8_e5m2' },
    { label: 'nf4', value: 'nf4' }
];

const TIMESTEP_SAMPLE_OPTIONS = [
    { label: 'Logit Normal', value: 'logit_normal' },
    { label: 'Uniform', value: 'uniform' }
];

const PathInput = ({
    label,
    name,
    data,
    handleChange,
    handlePickPath,
    placeholder,
    isFolder = false,
    openTitle,
    helpText
}: {
    label: string,
    name: string,
    data: any,
    handleChange: (e: any) => void,
    handlePickPath: (name: string, isFolder?: boolean) => void,
    placeholder?: string,
    isFolder?: boolean,
    openTitle: string,
    helpText?: string
}) => (
    <div className="relative">
        <GlassInput
            label={label}
            name={name}
            value={data[name] ?? ''}
            onChange={handleChange}
            placeholder={placeholder}
            helpText={helpText}
        />
        <button
            type="button"
            onClick={() => handlePickPath(name, isFolder)}
            className="absolute right-3 bottom-2.5 p-1 rounded-lg bg-white/5 hover:bg-white/10 text-muted-foreground transition-colors hover:text-primary"
            title={openTitle}
        >
            <FolderOpen className="w-4 h-4" />
        </button>
    </div>
);

export function ModelConfig({ data, onChange }: ModelConfigProps) {
    const { t } = useTranslation();
    const [modelType, setModelType] = useState('sdxl');
    const [qwenVariant, setQwenVariant] = useState<'qwen_image' | 'qwen_edit' | 'qwen_2509' | 'qwen_2511' | 'qwen_2512'>('qwen_image');

    // Initialize default if empty / Sync internal state with props
    // Initialize default if empty / Sync internal state with props
    useEffect(() => {
        if (data.model_type && data.model_type !== modelType) {
            setModelType(data.model_type);
        }

        // Sync qwen variant state based on model type OR explicit version
        if (data.model_type === 'qwen2511') {
            setQwenVariant('qwen_2511');
        } else if (data.model_type === 'qwen_image') {
            // Check version to distinguish between variants
            if (data.model_version === 'qwen_edit') setQwenVariant('qwen_edit');
            else if (data.model_version === 'qwen_2509') setQwenVariant('qwen_2509');
            else if (data.model_version === 'qwen_2512') setQwenVariant('qwen_2512');
            else if (data.model_version === 'qwen_image') setQwenVariant('qwen_image');
            else if (qwenVariant === 'qwen_2511') setQwenVariant('qwen_image'); // Fallback if coming from 2511
        } else if (!data.model_type) {
            onChange({ ...data, model_type: 'sdxl', dtype: 'bfloat16' });
        }
    }, [data.model_type, data.model_version]);

    const modelTypes = [
        { label: 'SDXL', value: 'sdxl' },
        { label: 'Flux', value: 'flux' },
        { label: 'Flux Kontext', value: 'flux_kontext' },
        { label: 'Flux 2', value: 'flux2' },
        { label: 'LTX Video', value: 'ltx_video' },
        { label: 'Hunyuan Video', value: 'hunyuan_video' },
        { label: 'Hunyuan Video 1.5', value: 'hunyuan_video_15' },
        { label: 'Hunyuan Image 2.1', value: 'hunyuan_image' },
        { label: 'Cosmos', value: 'cosmos' },
        { label: 'Cosmos Predict 2', value: 'cosmos_predict2' },
        { label: 'Lumina 2', value: 'lumina2' },
        { label: 'Wan 2.1', value: 'wan21' },
        { label: 'Wan 2.2', value: 'wan22' },
        { label: 'Chroma', value: 'chroma' },
        { label: 'HiDream', value: 'hidream' },
        { label: 'SD3', value: 'sd3' },
        { label: 'OmniGen 2', value: 'omnigen2' },
        { label: 'Qwen Image', value: 'qwen_image' },
        { label: 'AuraFlow', value: 'auraflow' },
        { label: 'Z-Image', value: 'z_image' },
    ];

    const handleTypeChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newType = e.target.value;
        setModelType(newType);
        // Set sensible defaults based on model type per supported_models.md
        const defaults = getDefaultsForModel(newType);
        onChange({ ...data, model_type: newType, ...defaults });
    };

    const getDefaultsForModel = (type: string) => {
        const base = { dtype: 'bfloat16' };
        switch (type) {
            case 'sdxl':
                return { ...base, unet_lr: 4e-5, text_encoder_1_lr: 2e-5, text_encoder_2_lr: 2e-5, v_pred: false, debiased_estimation_loss: false };
            case 'flux':
                return { ...base, transformer_dtype: 'float8', flux_shift: true, bypass_guidance_embedding: false };
            case 'flux_kontext':
                return { ...base, transformer_dtype: 'float8', flux_shift: false };
            case 'ltx_video':
                return { ...base, timestep_sample_method: 'logit_normal' };
            case 'hunyuan_video':
                return { ...base, transformer_dtype: 'float8', timestep_sample_method: 'logit_normal' };
            case 'cosmos':
                return { ...base };
            case 'lumina2':
                return { ...base, lumina_shift: true };
            case 'wan21':
                return { ...base, timestep_sample_method: 'logit_normal' };
            case 'wan22':
                return { ...base, transformer_dtype: 'float8', min_t: 0, max_t: 0.875 };
            case 'chroma':
                return { ...base, transformer_dtype: 'float8', flux_shift: true };
            case 'hidream':
                return { ...base, transformer_dtype: 'float8', llama3_4bit: true, max_llama3_sequence_length: 128, flux_shift: false };
            case 'sd3':
                return { ...base, flux_shift: false };
            case 'cosmos_predict2':
                return { ...base };
            case 'omnigen2':
                return { ...base, flux_shift: false };
            case 'qwen_image':
                return { ...base, transformer_dtype: 'float8', timestep_sample_method: 'logit_normal' };
            case 'qwen2511':
                return { ...base, transformer_dtype: 'bfloat16' };
            case 'hunyuan_image':
                return { ...base, transformer_dtype: 'float8' };
            case 'auraflow':
                return { ...base, transformer_dtype: 'float8', timestep_sample_method: 'logit_normal', max_sequence_length: 768 };
            case 'z_image':
                return { ...base };
            case 'hunyuan_video_15':
                return { ...base, diffusion_model_dtype: 'float8', timestep_sample_method: 'logit_normal', shift: 1 };
            case 'flux2':
                return { ...base, diffusion_model_dtype: 'float8', timestep_sample_method: 'logit_normal', shift: 3 };
            default:
                return base;
        }
    };

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        let value: any = e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value;

        // Handle number precision noise
        if (e.target.type === 'number' && typeof value === 'string' && value !== '') {
            const n = Number(value);
            if (!isNaN(n)) {
                const normalized = parseFloat(n.toFixed(10));
                if (Math.abs(n - normalized) > 0 && Math.abs(n - normalized) < 1e-12) {
                    value = normalized;
                }
            }
        }
        onChange({ ...data, [e.target.name]: value });
    };

    const handleQwenVariantChange = (variant: 'qwen_image' | 'qwen_edit' | 'qwen_2509' | 'qwen_2511' | 'qwen_2512') => {
        setQwenVariant(variant);
        // 2511 uses a different model type
        const newModelType = variant === 'qwen_2511' ? 'qwen2511' : 'qwen_image';

        // Reset defaults for the new variant
        const defaults = getDefaultsForModel(newModelType);

        // Update model_type in parent state
        onChange({
            ...data,
            model_type: newModelType,
            model_version: variant, // explicit version for qwen variants
            ...defaults
        });
    };

    // Format number for display - removes floating point noise
    const formatNum = (val: any): string | number => {
        if (val === undefined || val === null || val === '') return '';
        const n = Number(val);
        if (isNaN(n)) return val;
        // Round to 10 decimal places to eliminate floating point noise
        const normalized = parseFloat(n.toFixed(10));
        // If it's a nice round number, return as integer
        if (Number.isInteger(normalized)) return normalized;
        return normalized;
    };

    const handlePickPath = async (name: string, isFolder: boolean = false) => {
        try {
            // @ts-ignore
            const result = await window.ipcRenderer.invoke('dialog:openFile', {
                properties: isFolder ? ['openDirectory'] : ['openFile'],
                filters: isFolder ? [] : [{ name: 'Model Files', extensions: ['safetensors', 'pt', 'ckpt', 'bin'] }]
            });

            if (!result.canceled && result.filePaths.length > 0) {
                onChange({ ...data, [name]: result.filePaths[0] });
            }
        } catch (e) {
            console.error("Failed to pick path:", e);
        }
    };

    const renderFields = () => {
        switch (modelType) {
            case 'sdxl':
                return (
                    <>
                        <PathInput label={t('model.checkpoint_path')} helpText={t('help.checkpoint_path')} name="checkpoint_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder="/path/to/sdxl.safetensors" />
                        <GlassSelect label={t('model_load.dtype')} helpText={t('help.dtype')} name="dtype" value={data.dtype || 'bfloat16'} onChange={handleChange} options={DTYPE_OPTIONS} />
                        <GlassInput label={t('model.unet_lr')} helpText={t('help.unet_lr')} name="unet_lr" type="number" step="1e-7" value={formatNum(data.unet_lr ?? 4e-5)} onChange={handleChange} />
                        <GlassInput label={t('model.text_encoder_1_lr')} helpText={t('help.text_encoder_1_lr')} name="text_encoder_1_lr" type="number" step="1e-7" value={formatNum(data.text_encoder_1_lr ?? 2e-5)} onChange={handleChange} />
                        <GlassInput label={t('model.text_encoder_2_lr')} helpText={t('help.text_encoder_2_lr')} name="text_encoder_2_lr" type="number" step="1e-7" value={formatNum(data.text_encoder_2_lr ?? 2e-5)} onChange={handleChange} />
                        <GlassInput label={t('model.min_snr_gamma')} helpText={t('help.min_snr_gamma')} name="min_snr_gamma" type="number" step="0.1" value={formatNum(data.min_snr_gamma ?? '')} onChange={handleChange} placeholder={t('common.optional')} />
                        <div className="col-span-2 flex items-center gap-6 mt-2">
                            <div className="flex items-center gap-2">
                                <input type="checkbox" name="v_pred" id="v_pred" className="w-4 h-4" checked={!!data.v_pred} onChange={handleChange} />
                                <label htmlFor="v_pred" className="text-sm flex items-center gap-1 cursor-pointer">
                                    {t('model.v_pred')}
                                    <HelpIcon text={t('help.v_pred')} />
                                </label>
                            </div>
                            <div className="flex items-center gap-2">
                                <input type="checkbox" name="debiased_estimation_loss" id="debiased_estimation_loss" className="w-4 h-4" checked={!!data.debiased_estimation_loss} onChange={handleChange} />
                                <label htmlFor="debiased_estimation_loss" className="text-sm flex items-center gap-1 cursor-pointer">
                                    {t('model.debiased_estimation_loss')}
                                    <HelpIcon text={t('help.debiased_estimation_loss')} />
                                </label>
                            </div>
                        </div>
                    </>
                );

            case 'flux':
                return (
                    <>
                        <PathInput label={t('model.diffusers_path')} helpText={t('help.diffusers_path')} name="diffusers_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder="/path/to/FLUX.1-dev" isFolder={true} />
                        <PathInput label={t('model.transformer_path')} helpText={t('help.transformer_path')} name="transformer_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder={t('common.optional')} />
                        <GlassSelect label={t('model_load.dtype')} helpText={t('help.dtype')} name="dtype" value={data.dtype || 'bfloat16'} onChange={handleChange} options={DTYPE_OPTIONS} />
                        <GlassSelect label={t('model_load.transformer_dtype')} helpText={t('help.transformer_dtype')} name="transformer_dtype" value={data.transformer_dtype || 'float8'} onChange={handleChange} options={TRANSFORMER_DTYPE_OPTIONS} />
                        <div className="col-span-2 flex items-center gap-6 mt-2">
                            <div className="flex items-center gap-2">
                                <input type="checkbox" name="flux_shift" id="flux_shift" className="w-4 h-4" checked={data.flux_shift !== false} onChange={handleChange} />
                                <label htmlFor="flux_shift" className="text-sm flex items-center gap-1 cursor-pointer">
                                    {t('model.flux_shift')}
                                    <HelpIcon text={t('help.flux_shift')} />
                                </label>
                            </div>
                            <div className="flex items-center gap-2">
                                <input type="checkbox" name="bypass_guidance_embedding" id="bypass_guidance_embedding" className="w-4 h-4" checked={!!data.bypass_guidance_embedding} onChange={handleChange} />
                                <label htmlFor="bypass_guidance_embedding" className="text-sm flex items-center gap-1 cursor-pointer">
                                    {t('model.bypass_guidance_embedding')}
                                    <HelpIcon text={t('help.bypass_guidance_embedding')} />
                                </label>
                            </div>
                        </div>
                    </>
                );

            case 'flux_kontext':
                return (
                    <>
                        <PathInput label={t('model.diffusers_path')} helpText={t('help.diffusers_path')} name="diffusers_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder="/path/to/FLUX.1-dev" isFolder={true} />
                        <PathInput label={t('model.transformer_path')} helpText={t('help.transformer_path')} name="transformer_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder="flux1-kontext-dev.safetensors" />
                        <GlassSelect label={t('model_load.dtype')} helpText={t('help.dtype')} name="dtype" value={data.dtype || 'bfloat16'} onChange={handleChange} options={DTYPE_OPTIONS} />
                        <GlassSelect label={t('model_load.transformer_dtype')} helpText={t('help.transformer_dtype')} name="transformer_dtype" value={data.transformer_dtype || 'float8'} onChange={handleChange} options={TRANSFORMER_DTYPE_OPTIONS} />
                        <div className="col-span-2 flex items-center gap-2 mt-2">
                            <input type="checkbox" name="flux_shift" id="flux_shift_kontext" className="w-4 h-4" checked={!!data.flux_shift} onChange={handleChange} />
                            <label htmlFor="flux_shift_kontext" className="text-sm flex items-center gap-1 cursor-pointer">
                                {t('model.flux_shift')}
                                <HelpIcon text={t('help.flux_shift')} />
                            </label>
                        </div>
                    </>
                );

            case 'ltx_video':
                return (
                    <>
                        <PathInput label={t('model.diffusers_path')} helpText={t('help.diffusers_path')} name="diffusers_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder="/path/to/LTX-Video" isFolder={true} />
                        <PathInput label={t('model.single_file_path')} helpText={t('help.single_file_path')} name="single_file_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder={t('common.optional')} />
                        <GlassSelect label={t('model_load.dtype')} helpText={t('help.dtype')} name="dtype" value={data.dtype || 'bfloat16'} onChange={handleChange} options={DTYPE_OPTIONS} />
                        <GlassSelect label={t('model_load.transformer_dtype')} helpText={t('help.transformer_dtype')} name="transformer_dtype" value={data.transformer_dtype || ''} onChange={handleChange} options={[{ label: t('common.optional'), value: '' }, ...TRANSFORMER_DTYPE_OPTIONS]} />
                        <GlassSelect label={t('model_load.timestep_sample_method')} helpText={t('help.timestep_sample_method')} name="timestep_sample_method" value={data.timestep_sample_method || 'logit_normal'} onChange={handleChange} options={TIMESTEP_SAMPLE_OPTIONS} />
                        <GlassInput label={t('model.first_frame_conditioning_p')} helpText={t('help.first_frame_conditioning_p')} name="first_frame_conditioning_p" type="number" step="0.01" value={formatNum(data.first_frame_conditioning_p ?? '')} onChange={handleChange} placeholder={t('common.optional')} />
                    </>
                );

            case 'hunyuan_video':
                return (
                    <>
                        <PathInput label={t('model.ckpt_path_dir')} helpText={t('help.diffusers_path')} name="ckpt_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder={`${t('common.optional')} /path/to/ckpts`} isFolder={true} />
                        <PathInput label={t('model.transformer_path')} helpText={t('help.transformer_path')} name="transformer_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} />
                        <PathInput label={t('model.vae_path')} helpText={t('help.vae_path')} name="vae_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} />
                        <PathInput label={t('model.llm_path')} helpText={t('help.llm_path')} name="llm_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} isFolder={true} />
                        <PathInput label={t('model.clip_path')} helpText={t('help.clip_path')} name="clip_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} />
                        <GlassSelect label={t('model_load.dtype')} helpText={t('help.dtype')} name="dtype" value={data.dtype || 'bfloat16'} onChange={handleChange} options={DTYPE_OPTIONS} />
                        <GlassSelect label={t('model_load.transformer_dtype')} helpText={t('help.transformer_dtype')} name="transformer_dtype" value={data.transformer_dtype || 'float8'} onChange={handleChange} options={TRANSFORMER_DTYPE_OPTIONS} />
                        <GlassSelect label={t('model_load.timestep_sample_method')} helpText={t('help.timestep_sample_method')} name="timestep_sample_method" value={data.timestep_sample_method || 'logit_normal'} onChange={handleChange} options={TIMESTEP_SAMPLE_OPTIONS} />
                    </>
                );

            case 'cosmos':
                return (
                    <>
                        <PathInput label={t('model.transformer_path')} helpText={t('help.transformer_path')} name="transformer_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} />
                        <PathInput label={t('model.vae_path')} helpText={t('help.vae_path')} name="vae_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} />
                        <PathInput label={t('model.text_encoder_path')} helpText={t('help.text_encoder_path')} name="text_encoder_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} isFolder={true} />
                        <GlassSelect label={t('model_load.dtype')} helpText={t('help.dtype')} name="dtype" value={data.dtype || 'bfloat16'} onChange={handleChange} options={DTYPE_OPTIONS} />
                    </>
                );

            case 'cosmos_predict2':
                return (
                    <>
                        <PathInput label={t('model.transformer_path')} helpText={t('help.transformer_path')} name="transformer_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder="model.pt" />
                        <PathInput label={t('model.vae_path')} helpText={t('help.vae_path')} name="vae_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder="wan_2.1_vae.safetensors" />
                        <PathInput label={t('model.t5_path')} helpText={t('help.t5_path')} name="t5_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder="oldt5_xxl_fp16.safetensors" />
                        <GlassSelect label={t('model_load.dtype')} helpText={t('help.dtype')} name="dtype" value={data.dtype || 'bfloat16'} onChange={handleChange} options={DTYPE_OPTIONS} />
                        <GlassSelect label={t('model_load.transformer_dtype')} helpText={t('help.transformer_dtype')} name="transformer_dtype" value={data.transformer_dtype || ''} onChange={handleChange} options={[{ label: t('common.none'), value: '' }, { label: 'bfloat16', value: 'bfloat16' }, { label: 'float8_e5m2', value: 'float8_e5m2' }]} />
                    </>
                );

            case 'lumina2':
                return (
                    <>
                        <PathInput label={t('model.transformer_path')} helpText={t('help.transformer_path')} name="transformer_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} />
                        <PathInput label={t('model.llm_path')} helpText={t('help.llm_path')} name="llm_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder="gemma..." isFolder={true} />
                        <PathInput label={t('model.vae_path')} helpText={t('help.vae_path')} name="vae_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder="flux_vae.safetensors" />
                        <GlassSelect label={t('model_load.dtype')} helpText={t('help.dtype')} name="dtype" value={data.dtype || 'bfloat16'} onChange={handleChange} options={DTYPE_OPTIONS} />
                        <div className="col-span-2 flex items-center gap-2 mt-2">
                            <input type="checkbox" name="lumina_shift" id="lumina_shift" className="w-4 h-4" checked={data.lumina_shift !== false} onChange={handleChange} />
                            <label htmlFor="lumina_shift" className="text-sm flex items-center gap-1 cursor-pointer">
                                {t('model.lumina_shift')}
                                <HelpIcon text={t('help.lumina_shift')} />
                            </label>
                        </div>
                    </>
                );

            case 'wan21':
                return (
                    <>
                        <PathInput label={t('model.ckpt_path_dir')} helpText={t('help.diffusers_path')} name="ckpt_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder="/path/to/Wan2.1-T2V-1.3B" isFolder={true} />
                        <PathInput label={t('model.transformer_path')} helpText={t('help.transformer_path')} name="transformer_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder={t('common.optional')} />
                        <PathInput label={t('model.llm_path')} helpText={t('help.llm_path')} name="llm_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder={`${t('common.optional')} umt5-xxl...`} isFolder={true} />
                        <GlassSelect label={t('model_load.dtype')} helpText={t('help.dtype')} name="dtype" value={data.dtype || 'bfloat16'} onChange={handleChange} options={DTYPE_OPTIONS} />
                        <GlassSelect label={t('model_load.transformer_dtype')} helpText={t('help.transformer_dtype')} name="transformer_dtype" value={data.transformer_dtype || ''} onChange={handleChange} options={[{ label: t('common.none'), value: '' }, ...TRANSFORMER_DTYPE_OPTIONS]} />
                        <GlassSelect label={t('model_load.timestep_sample_method')} helpText={t('help.timestep_sample_method')} name="timestep_sample_method" value={data.timestep_sample_method || 'logit_normal'} onChange={handleChange} options={TIMESTEP_SAMPLE_OPTIONS} />
                    </>
                );

            case 'wan22':
                return (
                    <>
                        <PathInput label={t('model.ckpt_path_dir')} helpText={t('help.diffusers_path')} name="ckpt_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder="/path/to/Wan2.2-T2V-A14B" isFolder={true} />
                        <PathInput label={t('model.transformer_path')} helpText={t('help.transformer_path')} name="transformer_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder="low_noise_model or .safetensors" />
                        <PathInput label={t('model.llm_path')} helpText={t('help.llm_path')} name="llm_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder={`${t('common.optional')} umt5_xxl_fp16.safetensors`} />
                        <GlassSelect label={t('model_load.dtype')} helpText={t('help.dtype')} name="dtype" value={data.dtype || 'bfloat16'} onChange={handleChange} options={DTYPE_OPTIONS} />
                        <GlassSelect label={t('model_load.transformer_dtype')} helpText={t('help.transformer_dtype')} name="transformer_dtype" value={data.transformer_dtype || 'float8'} onChange={handleChange} options={TRANSFORMER_DTYPE_OPTIONS} />
                        <GlassInput label={t('model.min_t')} helpText={t('help.min_t')} name="min_t" type="number" step="0.01" value={formatNum(data.min_t ?? 0)} onChange={handleChange} />
                        <GlassInput label={t('model.max_t')} helpText={t('help.max_t')} name="max_t" type="number" step="0.01" value={formatNum(data.max_t ?? 0.875)} onChange={handleChange} />
                    </>
                );

            case 'chroma':
                return (
                    <>
                        <PathInput label={t('model.diffusers_path')} helpText={t('help.diffusers_path')} name="diffusers_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder="/path/to/FLUX.1-dev" isFolder={true} />
                        <PathInput label={t('model.transformer_path')} helpText={t('help.transformer_path')} name="transformer_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder="chroma-unlocked-v10.safetensors" />
                        <GlassSelect label={t('model_load.dtype')} helpText={t('help.dtype')} name="dtype" value={data.dtype || 'bfloat16'} onChange={handleChange} options={DTYPE_OPTIONS} />
                        <GlassSelect label={t('model_load.transformer_dtype')} helpText={t('help.transformer_dtype')} name="transformer_dtype" value={data.transformer_dtype || 'float8'} onChange={handleChange} options={TRANSFORMER_DTYPE_OPTIONS} />
                        <div className="col-span-2 flex items-center gap-2 mt-2">
                            <input type="checkbox" name="flux_shift" id="flux_shift_chroma" className="w-4 h-4" checked={data.flux_shift !== false} onChange={handleChange} />
                            <label htmlFor="flux_shift_chroma" className="text-sm flex items-center gap-1 cursor-pointer">
                                {t('model.flux_shift')}
                                <HelpIcon text={t('help.flux_shift')} />
                            </label>
                        </div>
                    </>
                );

            case 'hidream':
                return (
                    <>
                        <PathInput label={t('model.diffusers_path')} helpText={t('help.diffusers_path')} name="diffusers_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder="/path/to/HiDream-I1-Full" isFolder={true} />
                        <PathInput label={t('model.llama3_path')} helpText={t('help.llm_path')} name="llama3_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder="Meta-Llama-3.1-8B-Instruct" isFolder={true} />
                        <GlassSelect label={t('model_load.dtype')} helpText={t('help.dtype')} name="dtype" value={data.dtype || 'bfloat16'} onChange={handleChange} options={DTYPE_OPTIONS} />
                        <GlassSelect label={t('model_load.transformer_dtype')} helpText={t('help.transformer_dtype')} name="transformer_dtype" value={data.transformer_dtype || 'float8'} onChange={handleChange} options={TRANSFORMER_DTYPE_OPTIONS} />
                        <GlassInput label={t('model.max_llama3_sequence_length')} helpText={t('help.max_llama3_sequence_length')} name="max_llama3_sequence_length" type="number" value={formatNum(data.max_llama3_sequence_length ?? 128)} onChange={handleChange} />
                        <div className="col-span-2 flex items-center gap-6 mt-2">
                            <div className="flex items-center gap-2">
                                <input type="checkbox" name="llama3_4bit" id="llama3_4bit" className="w-4 h-4" checked={data.llama3_4bit !== false} onChange={handleChange} />
                                <label htmlFor="llama3_4bit" className="text-sm flex items-center gap-1 cursor-pointer">
                                    {t('model.llama3_4bit')}
                                    <HelpIcon text={t('help.llama3_4bit')} />
                                </label>
                            </div>
                            <div className="flex items-center gap-2">
                                <input type="checkbox" name="flux_shift" id="flux_shift_hidream" className="w-4 h-4" checked={!!data.flux_shift} onChange={handleChange} />
                                <label htmlFor="flux_shift_hidream" className="text-sm flex items-center gap-1 cursor-pointer">
                                    {t('model.flux_shift')}
                                    <HelpIcon text={t('help.flux_shift')} />
                                </label>
                            </div>
                        </div>
                    </>
                );

            case 'sd3':
                return (
                    <>
                        <PathInput label={t('model.diffusers_path')} helpText={t('help.diffusers_path')} name="diffusers_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder="/path/to/stable-diffusion-3.5-medium" isFolder={true} />
                        <GlassSelect label={t('model_load.dtype')} helpText={t('help.dtype')} name="dtype" value={data.dtype || 'bfloat16'} onChange={handleChange} options={DTYPE_OPTIONS} />
                        <GlassSelect label={t('model_load.transformer_dtype')} helpText={t('help.transformer_dtype')} name="transformer_dtype" value={data.transformer_dtype || ''} onChange={handleChange} options={[{ label: t('common.optional'), value: '' }, ...TRANSFORMER_DTYPE_OPTIONS]} />
                        <div className="col-span-2 flex items-center gap-2 mt-2">
                            <input type="checkbox" name="flux_shift" id="flux_shift_sd3" className="w-4 h-4" checked={!!data.flux_shift} onChange={handleChange} />
                            <label htmlFor="flux_shift_sd3" className="text-sm flex items-center gap-1 cursor-pointer">
                                {t('model.flux_shift')}
                                <HelpIcon text={t('help.flux_shift')} />
                            </label>
                        </div>
                    </>
                );

            case 'omnigen2':
                return (
                    <>
                        <PathInput label={t('model.diffusers_path')} helpText={t('help.diffusers_path')} name="diffusers_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder="/path/to/OmniGen2" isFolder={true} />
                        <GlassSelect label={t('model_load.dtype')} helpText={t('help.dtype')} name="dtype" value={data.dtype || 'bfloat16'} onChange={handleChange} options={DTYPE_OPTIONS} />
                        <div className="col-span-2 flex items-center gap-2 mt-2">
                            <input type="checkbox" name="flux_shift" id="flux_shift_omnigen2" className="w-4 h-4" checked={!!data.flux_shift} onChange={handleChange} />
                            <label htmlFor="flux_shift_omnigen2" className="text-sm flex items-center gap-1 cursor-pointer">
                                {t('model.flux_shift')}
                                <HelpIcon text={t('help.flux_shift')} />
                            </label>
                        </div>
                    </>
                );

            case 'qwen_image':
            case 'qwen2511':
                return (
                    <>
                        {/* Qwen Image variant tabs */}
                        <div className="col-span-2 flex gap-2 mb-4 flex-wrap">
                            <button
                                type="button"
                                onClick={() => handleQwenVariantChange('qwen_image')}
                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${qwenVariant === 'qwen_image' ? 'bg-blue-500/30 text-blue-300 border border-blue-500/50' : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'}`}
                            >
                                Qwen Image
                            </button>
                            <button
                                type="button"
                                onClick={() => handleQwenVariantChange('qwen_2509')}
                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${qwenVariant === 'qwen_2509' ? 'bg-blue-500/30 text-blue-300 border border-blue-500/50' : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'}`}
                            >
                                2509
                            </button>
                            <button
                                type="button"
                                onClick={() => handleQwenVariantChange('qwen_2511')}
                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${qwenVariant === 'qwen_2511' ? 'bg-blue-500/30 text-blue-300 border border-blue-500/50' : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'}`}
                            >
                                2511
                            </button>
                            <button
                                type="button"
                                onClick={() => handleQwenVariantChange('qwen_2512')}
                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${qwenVariant === 'qwen_2512' ? 'bg-blue-500/30 text-blue-300 border border-blue-500/50' : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'}`}
                            >
                                2512
                            </button>
                            <button
                                type="button"
                                onClick={() => handleQwenVariantChange('qwen_edit')}
                                className={`px-4 py-2 rounded-lg text-sm font-medium transition-all ${qwenVariant === 'qwen_edit' ? 'bg-blue-500/30 text-blue-300 border border-blue-500/50' : 'bg-white/5 text-gray-400 border border-white/10 hover:bg-white/10'}`}
                            >
                                Edit
                            </button>
                        </div>

                        {/* Fields based on variant */}
                        {/* Fields based on variant */}
                        <PathInput label={t('model.diffusers_path')} helpText={t('help.diffusers_path')} name="diffusers_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')}
                            placeholder={
                                qwenVariant === 'qwen_2511' ? 'Qwen-Image-Edit-2511' :
                                    qwenVariant === 'qwen_2509' ? 'Qwen-Image-Edit-2509 folder' :
                                        qwenVariant === 'qwen_edit' ? 'Qwen-Image-Edit folder' :
                                            `${t('common.optional')} Qwen-Image folder`
                            } isFolder={true} />
                        <PathInput label={t('model.transformer_path')} helpText={t('help.transformer_path')} name="transformer_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')}
                            placeholder={
                                qwenVariant === 'qwen_2511' ? `${t('common.optional')} qwen_image_edit_2511_bf16.safetensors` :
                                    qwenVariant === 'qwen_2509' ? `${t('common.optional')} qwen_image_edit_2509.safetensors` :
                                        qwenVariant === 'qwen_edit' ? `${t('common.optional')} qwen_image_edit_bf16.safetensors` :
                                            `${t('common.optional')} qwen_image_bf16.safetensors`
                            } />
                        <PathInput label={t('model.text_encoder_path')} helpText={t('help.text_encoder_path')} name="text_encoder_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')}
                            placeholder={`${t('common.optional')} qwen_2.5_vl_7b.safetensors`} />
                        <PathInput label={t('model.vae_path')} helpText={t('help.vae_path')} name="vae_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')}
                            placeholder={(qwenVariant === 'qwen_2511' || qwenVariant === 'qwen_2509' || qwenVariant === 'qwen_edit') ? `${t('common.optional')} qwen_image_vae.safetensors` : `${t('common.optional')} Diffusers VAE required`} />
                        <GlassSelect label={t('model_load.dtype')} helpText={t('help.dtype')} name="dtype" value={data.dtype || 'bfloat16'} onChange={handleChange} options={DTYPE_OPTIONS} />
                        <GlassSelect label={t('model_load.transformer_dtype')} helpText={t('help.transformer_dtype')} name="transformer_dtype" value={data.transformer_dtype || ((qwenVariant === 'qwen_2511' || qwenVariant === 'qwen_2509') ? 'bfloat16' : 'float8')} onChange={handleChange} options={TRANSFORMER_DTYPE_OPTIONS} />
                        {(qwenVariant === 'qwen_image' || qwenVariant === 'qwen_2512' || qwenVariant === 'qwen_edit') && (
                            <GlassSelect label={t('model_load.timestep_sample_method')} helpText={t('help.timestep_sample_method')} name="timestep_sample_method" value={data.timestep_sample_method || 'logit_normal'} onChange={handleChange} options={TIMESTEP_SAMPLE_OPTIONS} />
                        )}
                    </>
                );

            case 'hunyuan_image':
                return (
                    <>
                        <PathInput label={t('model.transformer_path')} helpText={t('help.transformer_path')} name="transformer_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder="hunyuanimage2.1.safetensors" />
                        <PathInput label={t('model.vae_path')} helpText={t('help.vae_path')} name="vae_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder="hunyuan_image_2.1_vae_fp16.safetensors" />
                        <PathInput label={t('model.text_encoder_path')} helpText={t('help.text_encoder_path')} name="text_encoder_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder="qwen_2.5_vl_7b.safetensors" />
                        <PathInput label={t('model.byt5_path')} helpText={t('help.byt5_path')} name="byt5_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder="byt5_small_glyphxl_fp16.safetensors" />
                        <GlassSelect label={t('model_load.dtype')} helpText={t('help.dtype')} name="dtype" value={data.dtype || 'bfloat16'} onChange={handleChange} options={DTYPE_OPTIONS} />
                        <GlassSelect label={t('model_load.transformer_dtype')} helpText={t('help.transformer_dtype')} name="transformer_dtype" value={data.transformer_dtype || 'float8'} onChange={handleChange} options={TRANSFORMER_DTYPE_OPTIONS} />
                    </>
                );

            case 'auraflow':
                return (
                    <>
                        <PathInput label={t('model.transformer_path')} helpText={t('help.transformer_path')} name="transformer_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder="pony-v7-base.safetensors" />
                        <PathInput label={t('model.text_encoder_path')} helpText={t('help.text_encoder_path')} name="text_encoder_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder="umt5_auraflow.fp16.safetensors" />
                        <PathInput label={t('model.vae_path')} helpText={t('help.vae_path')} name="vae_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder="sdxl_vae.safetensors" />
                        <GlassSelect label={t('model_load.dtype')} helpText={t('help.dtype')} name="dtype" value={data.dtype || 'bfloat16'} onChange={handleChange} options={DTYPE_OPTIONS} />
                        <GlassSelect label={t('model_load.transformer_dtype')} helpText={t('help.transformer_dtype')} name="transformer_dtype" value={data.transformer_dtype || 'float8'} onChange={handleChange} options={TRANSFORMER_DTYPE_OPTIONS} />
                        <GlassSelect label={t('model_load.timestep_sample_method')} helpText={t('help.timestep_sample_method')} name="timestep_sample_method" value={data.timestep_sample_method || 'logit_normal'} onChange={handleChange} options={TIMESTEP_SAMPLE_OPTIONS} />
                        <GlassInput label={t('model.max_sequence_length')} helpText={t('help.max_sequence_length')} name="max_sequence_length" type="number" value={formatNum(data.max_sequence_length ?? 768)} onChange={handleChange} />
                    </>
                );

            case 'z_image':
                return (
                    <>
                        <PathInput label={t('model.diffusion_model')} helpText={t('help.diffusion_model')} name="diffusion_model" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder="z_image_turbo_bf16.safetensors" />
                        <PathInput label={t('model.vae_path')} helpText={t('help.vae_path')} name="vae" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder="flux_vae.safetensors" />
                        <PathInput label={t('model.text_encoder_path')} helpText={t('help.text_encoder_path')} name="text_encoder_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder="qwen_3_4b.safetensors (type=lumina2)" />
                        <PathInput label={t('model.merge_adapters')} helpText={t('help.merge_adapters')} name="merge_adapters" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder={`${t('common.optional')} (Turbo) zimage_turbo_training_adapter_v1.safetensors`} />
                        <GlassSelect label={t('model_load.dtype')} helpText={t('help.dtype')} name="dtype" value={data.dtype || 'bfloat16'} onChange={handleChange} options={DTYPE_OPTIONS} />
                        <GlassSelect label={t('model_load.diffusion_model_dtype')} helpText={t('help.transformer_dtype')} name="diffusion_model_dtype" value={data.diffusion_model_dtype || ''} onChange={handleChange} options={[{ label: t('common.optional'), value: '' }, ...TRANSFORMER_DTYPE_OPTIONS]} />
                    </>
                );

            case 'hunyuan_video_15':
                return (
                    <>
                        <PathInput label={t('model.diffusion_model')} helpText={t('help.diffusion_model')} name="diffusion_model" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder="hunyuanvideo1.5_480p_t2v_fp16.safetensors" />
                        <PathInput label={t('model.vae_path')} helpText={t('help.vae_path')} name="vae" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder="hunyuanvideo15_vae_fp16.safetensors" />
                        <PathInput label={`${t('model.text_encoder_path')} (Qwen)`} helpText={t('help.text_encoder_path')} name="text_encoder_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder="qwen_2.5_vl_7b.safetensors" />
                        <PathInput label={`${t('model.byt5_path')} (ByT5)`} helpText={t('help.byt5_path')} name="byt5_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder="byt5_small_glyphxl_fp16.safetensors" />
                        <GlassSelect label={t('model_load.dtype')} helpText={t('help.dtype')} name="dtype" value={data.dtype || 'bfloat16'} onChange={handleChange} options={DTYPE_OPTIONS} />
                        <GlassSelect label={t('model_load.diffusion_model_dtype')} helpText={t('help.transformer_dtype')} name="diffusion_model_dtype" value={data.diffusion_model_dtype || 'float8'} onChange={handleChange} options={TRANSFORMER_DTYPE_OPTIONS} />
                        <GlassSelect label={t('model_load.timestep_sample_method')} helpText={t('help.timestep_sample_method')} name="timestep_sample_method" value={data.timestep_sample_method || 'logit_normal'} onChange={handleChange} options={TIMESTEP_SAMPLE_OPTIONS} />
                        <GlassInput label={t('model.shift')} helpText={t('help.shift')} name="shift" type="number" value={formatNum(data.shift ?? 1)} onChange={handleChange} />
                    </>
                );

            case 'flux2':
                return (
                    <>
                        <PathInput label={t('model.diffusion_model')} helpText={t('help.diffusion_model')} name="diffusion_model" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder="flux2-dev.safetensors" />
                        <PathInput label={t('model.vae_path')} helpText={t('help.vae_path')} name="vae" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder="flux2-vae.safetensors" />
                        <PathInput label={`${t('model.text_encoder_path')} (Qwen)`} helpText={t('help.text_encoder_path')} name="text_encoder_path" data={data} handleChange={handleChange} handlePickPath={handlePickPath} openTitle={t('project.open')} placeholder="qwen_3_4b.safetensors (type=flux2)" />
                        <GlassSelect label={t('model_load.dtype')} helpText={t('help.dtype')} name="dtype" value={data.dtype || 'bfloat16'} onChange={handleChange} options={DTYPE_OPTIONS} />
                        <GlassSelect label={t('model_load.diffusion_model_dtype')} helpText={t('help.transformer_dtype')} name="diffusion_model_dtype" value={data.diffusion_model_dtype || 'float8'} onChange={handleChange} options={TRANSFORMER_DTYPE_OPTIONS} />
                        <GlassSelect label={t('model_load.timestep_sample_method')} helpText={t('help.timestep_sample_method')} name="timestep_sample_method" value={data.timestep_sample_method || 'logit_normal'} onChange={handleChange} options={TIMESTEP_SAMPLE_OPTIONS} />
                        <GlassInput label={t('model.shift')} helpText={t('help.shift')} name="shift" type="number" value={formatNum(data.shift ?? 3)} onChange={handleChange} />
                    </>
                );

            default:
                return <p className="text-muted-foreground italic">{t('model.not_implemented')}</p>;
        }
    };

    return (
        <GlassCard className="p-6">
            <div className="mb-6 flex justify-between items-start">
                <div>
                    <h3 className="text-2xl font-bold">{t('model.title')}</h3>
                    <p className="text-sm text-muted-foreground">{t('model.desc')}</p>
                </div>
                <div className="w-48">
                    <GlassSelect
                        label={t('model.architecture')}
                        helpText={t('help.model_architecture')}
                        options={modelTypes}
                        value={modelType === 'qwen2511' ? 'qwen_image' : modelType}
                        onChange={handleTypeChange}
                    />
                </div>
            </div>

            <div className="space-y-6">
                <div className="grid gap-6 md:grid-cols-2">
                    {renderFields()}
                </div>
            </div>
        </GlassCard>
    );
}
