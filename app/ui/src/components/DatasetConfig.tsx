import { ipc, isElectron } from '@/lib/ipc';
import React, { useState, useEffect, useRef } from 'react';
import { GlassCard } from './ui/GlassCard';
import { GlassInput } from './ui/GlassInput';
import { GlassSelect } from './ui/GlassSelect';
import { GlassButton } from './ui/GlassButton';
import { GlassConfirmDialog } from './ui/GlassConfirmDialog';
import { useGlassToast } from './ui/GlassToast';
import { Save, RotateCcw, Plus, Trash2, CheckCircle2, FolderOpen } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { HelpIcon } from './ui/HelpIcon';
import { WebDatasetUpload } from './WebDatasetUpload';
import { WebPathPicker } from './ui/WebPathPicker';
import { tomlPath, tomlString } from '@/lib/toml';

interface DatasetConfigProps {
    mode?: 'training' | 'evaluation';
    importedConfig?: any;
    modelType?: string;
    modelVersion?: string;
    onPathsChange?: (paths: string[]) => void;
    onSetsChange?: (sets: { name: string, path: string }[]) => void;
}

const DEFAULT_CONFIG = {
    input_path: '',
    resolutions: '[512]',
    enable_ar_bucket: 'true',
    min_ar: '0.5',
    max_ar: '2.0',
    num_ar_buckets: 7,
    num_repeats: 1,
    frame_buckets: '',
    ar_buckets: '',
    control_paths: [''] as string[],
    eval_sets: [{ name: 'validation_set', path: '' }] as { name: string, path: string }[],
    disable_validation: 'false',
    // Shuffle tags settings
    cache_shuffle_num: 0,
    cache_shuffle_delimiter: ', ',
    mask_path: '',
    // Skip images without caption file (default true: skip)
    skip_empty_caption: 'true',
    // Multi-dataset support for training
    train_sets: [] as { input_path: string, num_repeats: number, control_paths: string[], mask_path: string }[]
};


export function DatasetConfig({ mode = 'training', importedConfig, modelType, modelVersion, onPathsChange, onSetsChange }: DatasetConfigProps) {
    const { t } = useTranslation();
    const { showToast } = useGlassToast();
    const [formData, setFormData] = useState(DEFAULT_CONFIG);
    const [webPickerOpen, setWebPickerOpen] = useState(false);
    const webPickCallbackRef = useRef<((path: string) => void) | null>(null);

    // Notify parent of path changes
    useEffect(() => {
        if (mode === 'training') {
            // Include main path, control paths, and all train_sets paths
            const trainSetsPaths = formData.train_sets.flatMap(s => [s.input_path, ...s.control_paths]);
            onPathsChange?.([formData.input_path, ...formData.control_paths, ...trainSetsPaths]);
        } else {
            // Evaluation mode
            if (formData.disable_validation === 'true') {
                // If disabled, tell parent there are no eval sets
                onPathsChange?.([]);
                onSetsChange?.([]);
            } else {
                onPathsChange?.(formData.eval_sets.map(s => s.path));
                onSetsChange?.(formData.eval_sets);
            }
        }
    }, [formData.input_path, formData.eval_sets, formData.control_paths, formData.train_sets, formData.disable_validation, onPathsChange, onSetsChange, mode]);
    const [isResetDialogOpen, setIsResetDialogOpen] = useState(false);
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const isFirstRender = useRef(true);

    const isVideoModel = ['hunyuan_video', 'ltx_video', 'ltx2', 'wan21', 'wan22', 'hunyuan_video_15', 'cosmos', 'minimax_h3'].includes(modelType || '');
    const isEditingModel = modelType === 'flux_kontext' || modelType === 'qwen2511' || modelType === 'flux2' ||
        (modelType === 'qwen_image' && ['qwen_edit', 'qwen_2509'].includes(modelVersion || ''));

    React.useEffect(() => {
        // Special handling for evaluation mode: if no config is imported, it implies validation is disabled
        if (mode === 'evaluation' && !importedConfig) {
            setFormData(prev => ({
                ...prev,
                disable_validation: 'true',
                // Clear any leftover paths just in case
                eval_sets: [{ name: 'validation_set', path: '' }]
            }));
            return;
        }

        if (importedConfig) {
            console.log("Importing Dataset Config:", importedConfig);

            // Handle control paths import (could be string or array)
            let importedControlPaths = [''];
            const dirConfig = importedConfig.directory?.[0];
            if (dirConfig) {
                if (Array.isArray(dirConfig.control_path)) {
                    importedControlPaths = dirConfig.control_path;
                } else if (dirConfig.control_path) {
                    importedControlPaths = [dirConfig.control_path];
                }
            }

            // Handle additional training sets from directories at index 1+
            const additionalTrainSets: { input_path: string, num_repeats: number, control_paths: string[], mask_path: string }[] = [];
            if (mode === 'training' && importedConfig.directory && importedConfig.directory.length > 1) {
                for (let i = 1; i < importedConfig.directory.length; i++) {
                    const dir = importedConfig.directory[i];
                    let ctrlPaths = [''];
                    if (Array.isArray(dir.control_path)) {
                        ctrlPaths = dir.control_path;
                    } else if (dir.control_path) {
                        ctrlPaths = [dir.control_path];
                    }
                    additionalTrainSets.push({
                        input_path: dir.path || '',
                        num_repeats: dir.num_repeats ?? 1,
                        control_paths: ctrlPaths,
                        mask_path: dir.mask_path || ''
                    });
                }
            }

            setFormData(prev => ({
                ...prev,
                resolutions: JSON.stringify(importedConfig.resolutions || [512]),
                enable_ar_bucket: String(importedConfig.enable_ar_bucket ?? true),
                min_ar: String(importedConfig.min_ar ?? 0.5),
                max_ar: String(importedConfig.max_ar ?? 2.0),
                num_ar_buckets: importedConfig.num_ar_buckets ?? 7,
                // Handle directory list - take first one
                input_path: importedConfig.directory?.[0]?.path || prev.input_path,
                control_paths: importedControlPaths,
                num_repeats: importedConfig.directory?.[0]?.num_repeats ?? prev.num_repeats,
                // Optional advanced fields
                frame_buckets: importedConfig.frame_buckets ? JSON.stringify(importedConfig.frame_buckets) : prev.frame_buckets,
                ar_buckets: importedConfig.ar_buckets ? JSON.stringify(importedConfig.ar_buckets) : prev.ar_buckets,
                // Handle multiple evaluation sets if present in imported config
                eval_sets: mode === 'evaluation' && importedConfig.directory?.[0]
                    ? [{ name: 'validation_set', path: importedConfig.directory[0].path }]
                    : prev.eval_sets,
                // Explicitly enable if config exists
                disable_validation: 'false',
                // Shuffle settings
                cache_shuffle_num: importedConfig.cache_shuffle_num ?? prev.cache_shuffle_num,
                cache_shuffle_delimiter: importedConfig.cache_shuffle_delimiter ?? prev.cache_shuffle_delimiter,
                skip_empty_caption: String(
                    importedConfig.directory?.[0]?.skip_empty_caption
                    ?? importedConfig.skip_empty_caption
                    ?? true
                ),
                // Mask path from first directory
                mask_path: importedConfig.directory?.[0]?.mask_path || prev.mask_path,
                // Load additional training sets
                train_sets: additionalTrainSets
            }));
        }
    }, [importedConfig, mode]);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleControlPathChange = (index: number, value: string) => {
        const newPaths = [...formData.control_paths];
        newPaths[index] = value;
        setFormData(prev => ({ ...prev, control_paths: newPaths }));
    };

    const addControlPath = () => {
        setFormData(prev => ({ ...prev, control_paths: [...prev.control_paths, ''] }));
    };

    const removeControlPath = (index: number) => {
        const newPaths = formData.control_paths.filter((_, i) => i !== index);
        setFormData(prev => ({ ...prev, control_paths: newPaths.length ? newPaths : [''] }));
    };

    const handleEvalSetNameChange = (index: number, name: string) => {
        const newSets = [...formData.eval_sets];
        newSets[index] = { ...newSets[index], name };
        setFormData(prev => ({ ...prev, eval_sets: newSets }));
    };

    const handleEvalSetPathChange = (index: number, path: string) => {
        const newSets = [...formData.eval_sets];
        newSets[index] = { ...newSets[index], path };
        setFormData(prev => ({ ...prev, eval_sets: newSets }));
    };

    const addEvalSet = () => {
        const name = `validation_set_${formData.eval_sets.length + 1}`;
        setFormData(prev => ({ ...prev, eval_sets: [...prev.eval_sets, { name, path: '' }] }));
    };

    const removeEvalSet = async (index: number) => {
        // Calculate the file that will become redundant (the last one)
        const currentLength = formData.eval_sets.length;
        const lastIndex = currentLength - 1;
        const filename = lastIndex === 0 ? 'evaldataset.toml' : `evaldataset_${lastIndex}.toml`;

        try {
            // @ts-ignore
            await ipc.invoke('delete-from-date-folder', {
                filename: filename
            });
        } catch (e) {
            console.error("Failed to delete config file:", e);
        }

        const newSets = formData.eval_sets.filter((_, i) => i !== index);
        setFormData(prev => ({ ...prev, eval_sets: newSets.length ? newSets : [{ name: 'validation_set', path: '' }] }));
    };

    // === Training Set Handlers ===
    const addTrainSet = () => {
        setFormData(prev => ({
            ...prev,
            train_sets: [...prev.train_sets, { input_path: '', num_repeats: 1, control_paths: [''], mask_path: '' }]
        }));
    };

    const removeTrainSet = (index: number) => {
        const newSets = formData.train_sets.filter((_, i) => i !== index);
        setFormData(prev => ({ ...prev, train_sets: newSets }));
    };

    const handleTrainSetPathChange = (index: number, path: string) => {
        const newSets = [...formData.train_sets];
        newSets[index] = { ...newSets[index], input_path: path };
        setFormData(prev => ({ ...prev, train_sets: newSets }));
    };

    const handleTrainSetRepeatsChange = (index: number, repeats: number) => {
        const newSets = [...formData.train_sets];
        newSets[index] = { ...newSets[index], num_repeats: repeats };
        setFormData(prev => ({ ...prev, train_sets: newSets }));
    };

    const handleTrainSetControlPathChange = (setIndex: number, pathIndex: number, value: string) => {
        const newSets = [...formData.train_sets];
        const newControlPaths = [...newSets[setIndex].control_paths];
        newControlPaths[pathIndex] = value;
        newSets[setIndex] = { ...newSets[setIndex], control_paths: newControlPaths };
        setFormData(prev => ({ ...prev, train_sets: newSets }));
    };

    const addTrainSetControlPath = (setIndex: number) => {
        const newSets = [...formData.train_sets];
        newSets[setIndex] = { ...newSets[setIndex], control_paths: [...newSets[setIndex].control_paths, ''] };
        setFormData(prev => ({ ...prev, train_sets: newSets }));
    };

    const removeTrainSetControlPath = (setIndex: number, pathIndex: number) => {
        const newSets = [...formData.train_sets];
        const newControlPaths = newSets[setIndex].control_paths.filter((_, i) => i !== pathIndex);
        newSets[setIndex] = { ...newSets[setIndex], control_paths: newControlPaths.length ? newControlPaths : [''] };
        setFormData(prev => ({ ...prev, train_sets: newSets }));
    };


    const handlePickDir = async (callback: (path: string) => void) => {
        if (!isElectron) {
            webPickCallbackRef.current = callback;
            setWebPickerOpen(true);
            return;
        }
        try {
            // @ts-ignore
            const result = await ipc.invoke('dialog:openFile', {
                properties: ['openDirectory', 'createDirectory']
            });
            if (!result.canceled && result.filePaths.length > 0) {
                callback(result.filePaths[0]);
            }
        } catch (e) {
            console.error("Failed to pick directory:", e);
        }
    };

    const validate = (): { valid: boolean; message?: string } => {
        try {
            JSON.parse(formData.resolutions);
        } catch {
            return { valid: false, message: t('validation.invalid_resolutions') };
        }

        const minAr = parseFloat(formData.min_ar);
        const maxAr = parseFloat(formData.max_ar);
        if (isNaN(minAr) || isNaN(maxAr) || minAr <= 0 || maxAr <= 0) {
            return { valid: false, message: t('validation.invalid_number') };
        }
        if (maxAr < minAr) {
            return { valid: false, message: t('validation.min_max_ar') };
        }

        if (Number(formData.num_ar_buckets) <= 0) {
            return { valid: false, message: t('validation.invalid_integer') };
        }
        if (Number(formData.num_repeats) <= 0) {
            return { valid: false, message: t('validation.invalid_integer') };
        }

        if (formData.ar_buckets) {
            try {
                const parsed = JSON.parse(formData.ar_buckets);
                if (!Array.isArray(parsed)) throw new Error();
            } catch {
                return { valid: false, message: t('validation.invalid_json') };
            }
        }
        if (formData.frame_buckets) {
            try {
                const parsed = JSON.parse(formData.frame_buckets);
                if (!Array.isArray(parsed)) throw new Error();
            } catch {
                return { valid: false, message: t('validation.invalid_json') };
            }
        }

        return { valid: true };
    };

    const saveConfig = async (silent: boolean = false) => {
        const { valid, message } = validate();
        if (!valid) {
            if (!silent) {
                showToast(message || 'Invalid input', 'error');
            }
            return;
        }

        try {
            let resolutionsStr = '[[512, 512]]';
            try {
                const parsed = JSON.parse(formData.resolutions);
                if (Array.isArray(parsed)) {
                    if (parsed.length > 0 && !Array.isArray(parsed[0])) {
                        resolutionsStr = `[${parsed.join(', ')}]`;
                    } else {
                        const inner = parsed.map((r: any) => `[${Array.isArray(r) ? r.join(', ') : r}]`).join(', ');
                        resolutionsStr = `[${inner}]`;
                    }
                }
            } catch { /* 使用默认值 */ }

            const formatFloat = (n: number) => {
                if (Number.isInteger(n)) {
                    return `${n}.0`;
                }
                return parseFloat(n.toFixed(10)).toString();
            };

            const lines: string[] = [];
            lines.push(`resolutions = ${resolutionsStr}`);
            lines.push(`enable_ar_bucket = ${formData.enable_ar_bucket === 'true'}`);
            lines.push(`min_ar = ${formatFloat(Number(formData.min_ar))}`);
            lines.push(`max_ar = ${formatFloat(Number(formData.max_ar))}`);
            lines.push(`num_ar_buckets = ${Number(formData.num_ar_buckets)}`);

            if (formData.ar_buckets) {
                try {
                    const arBuckets = JSON.parse(formData.ar_buckets);
                    lines.push(`ar_buckets = ${JSON.stringify(arBuckets).replace(/"/g, '')}`);
                } catch { /* 忽略无效 JSON */ }
            }
            if (formData.frame_buckets) {
                try {
                    const frameBuckets = JSON.parse(formData.frame_buckets);
                    lines.push(`frame_buckets = ${JSON.stringify(frameBuckets).replace(/"/g, '')}`);
                } catch { /* 忽略无效 JSON */ }
            }

            const baseContent = lines.join('\n');

            if (isTraining) {
                const trainLines = [baseContent];

                // Global shuffle settings
                if (Number(formData.cache_shuffle_num) > 0) {
                    trainLines.push(`cache_shuffle_num = ${Number(formData.cache_shuffle_num)}`);
                    if (formData.cache_shuffle_delimiter && formData.cache_shuffle_delimiter !== ', ') {
                        trainLines.push(`cache_shuffle_delimiter = ${tomlString(formData.cache_shuffle_delimiter)}`);
                    }
                }

                // Only write when user opts out of the default skip behavior
                if (formData.skip_empty_caption === 'false') {
                    trainLines.push(`skip_empty_caption = false`);
                }

                // Main dataset
                trainLines.push('\n[[directory]]');
                trainLines.push(`path = ${tomlPath(formData.input_path)}`);
                trainLines.push(`num_repeats = ${Number(formData.num_repeats)}`);

                // Add mask_path for main dataset if provided
                if (formData.mask_path) {
                    trainLines.push(`mask_path = ${tomlPath(formData.mask_path)}`);
                }

                const validControlPaths = isEditingModel ? formData.control_paths.filter(p => p && p.trim() !== '') : [];
                if (isEditingModel && validControlPaths.length > 0) {
                    if (validControlPaths.length === 1) {
                        trainLines.push(`control_path = ${tomlPath(validControlPaths[0])}`);
                    } else {
                        const pathsArray = validControlPaths.map(tomlPath).join(', ');
                        trainLines.push(`control_path = [${pathsArray}]`);
                    }
                }

                // Additional training sets
                for (const trainSet of formData.train_sets) {
                    trainLines.push('\n[[directory]]');
                    trainLines.push(`path = ${tomlPath(trainSet.input_path)}`);
                    trainLines.push(`num_repeats = ${Number(trainSet.num_repeats)}`);

                    // Add mask_path for additional training set if provided
                    if (trainSet.mask_path) {
                        trainLines.push(`mask_path = ${tomlPath(trainSet.mask_path)}`);
                    }

                    if (isEditingModel) {
                        const ctrlPaths = trainSet.control_paths.filter(p => p && p.trim() !== '');
                        if (ctrlPaths.length === 1) {
                            trainLines.push(`control_path = ${tomlPath(ctrlPaths[0])}`);
                        } else if (ctrlPaths.length > 1) {
                            const pathsArray = ctrlPaths.map(tomlPath).join(', ');
                            trainLines.push(`control_path = [${pathsArray}]`);
                        }
                    }
                }

                const tomlContent = trainLines.join('\n');
                await ipc.invoke('save-to-date-folder', {
                    filename: 'dataset.toml',
                    content: tomlContent
                });

            } else {
                // Evaluation mode
                if (formData.disable_validation === 'true') {
                    // Skip saving if validation is disabled
                    if (!silent) {
                        showToast(t('common.config_saved'), 'success'); // Fake success or just silence
                    }
                    return;
                }

                // Evaluation mode - Save each set as a separate TOML
                for (let i = 0; i < formData.eval_sets.length; i++) {
                    const set = formData.eval_sets[i];
                    const evalLines = [baseContent];
                    evalLines.push('\n[[directory]]');
                    evalLines.push(`path = ${tomlPath(set.path)}`);
                    evalLines.push(`num_repeats = 1`); // Evaluation usually repeats 1

                    const filename = i === 0 ? 'evaldataset.toml' : `evaldataset_${i}.toml`;
                    const tomlContent = evalLines.join('\n');
                    await ipc.invoke('save-to-date-folder', {
                        filename,
                        content: tomlContent
                    });
                }
            }

            if (!silent) {
                showToast(t('common.config_saved'), 'success');
            }
        } catch (error: any) {
            console.error('Error saving config:', error);
            if (!silent) {
                showToast(error.message || 'Failed to save configuration', 'error');
            }
        }
    };

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        saveConfig(false);
    };

    useEffect(() => {
        if (isFirstRender.current) {
            isFirstRender.current = false;
            return;
        }

        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }

        saveTimeoutRef.current = setTimeout(() => {
            saveConfig(true);
        }, 1000); // 1s debounce

        return () => {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
            }
        };
    }, [formData, modelType, modelVersion]);

    const handleReset = () => {
        setFormData(DEFAULT_CONFIG);
    };

    const isTraining = mode === 'training';

    return (
        <div className="space-y-6">
            <GlassCard className="p-6">
                <div className="mb-6">
                    <div className="flex items-center gap-2">
                        <h3 className="text-2xl font-bold">{isTraining ? t('dataset.title') : t('dataset.eval_title')}</h3>
                        {!isTraining && <HelpIcon text={t('help.eval_dataset')} />}
                    </div>
                    <p className="text-sm text-muted-foreground">{isTraining ? t('dataset.desc') : t('dataset.eval_desc')}</p>
                </div>

                <form
                    onSubmit={handleSubmit}
                    className="space-y-6"
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            saveConfig(false);
                        }
                    }}
                >
                    <div className="grid gap-6 md:grid-cols-2">
                        {isTraining && !isElectron && (
                            <WebDatasetUpload
                                onUploaded={(path) => setFormData((previous) => ({ ...previous, input_path: path }))}
                            />
                        )}
                        {isTraining ? (
                            <div className="col-span-2 relative">
                                <GlassInput
                                    label={t('dataset.input_path')}
                                    helpText={t('help.dataset_input_path')}
                                    name="input_path"
                                    value={formData.input_path}
                                    onChange={handleChange}
                                    placeholder={t('dataset.input_path_placeholder')}
                                />
                                <button
                                    type="button"
                                    onClick={() => handlePickDir((path) => setFormData(prev => ({ ...prev, input_path: path })))}
                                    className="absolute right-3 bottom-2.5 p-1 rounded-lg bg-white/5 hover:bg-white/10 text-muted-foreground transition-colors hover:text-primary"
                                    title={t('project.open')}
                                >
                                    <FolderOpen className="w-4 h-4" />
                                </button>
                            </div>
                        ) : (
                            <div className="col-span-2 space-y-4">
                                <div className="mb-6">
                                    <button
                                        type="button"
                                        onClick={async () => {
                                            const newValue = formData.disable_validation === 'true' ? 'false' : 'true';
                                            if (newValue === 'true') {
                                                // Delete all existing eval config files
                                                for (let i = 0; i < formData.eval_sets.length; i++) {
                                                    const filename = i === 0 ? 'evaldataset.toml' : `evaldataset_${i}.toml`;
                                                    try {
                                                        // @ts-ignore
                                                        await ipc.invoke('delete-from-date-folder', { filename });
                                                    } catch (e) {
                                                        console.error(`Failed to delete ${filename}:`, e);
                                                    }
                                                }
                                            }
                                            handleChange({ target: { name: 'disable_validation', value: newValue } } as any);
                                        }}
                                        className={`w-full py-4 px-6 rounded-xl border flex items-center justify-center gap-3 transition-all duration-300 group ${formData.disable_validation === 'true'
                                            ? 'bg-red-500/10 border-red-500/30 text-red-400 hover:bg-red-500/20'
                                            : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/20'
                                            }`}
                                    >
                                        {formData.disable_validation === 'true' ? (
                                            <>
                                                <div className="p-2 rounded-full bg-red-500/20 group-hover:scale-110 transition-transform">
                                                    <Trash2 className="w-6 h-6" />
                                                </div>
                                                <div className="text-left">
                                                    <div className="font-bold text-lg">{t('dataset.validation_disabled')}</div>
                                                    <div className="text-xs opacity-70 font-normal">{t('dataset.validation_disabled_desc')}</div>
                                                </div>
                                            </>
                                        ) : (
                                            <>
                                                <div className="p-2 rounded-full bg-emerald-500/20 group-hover:scale-110 transition-transform">
                                                    <CheckCircle2 className="w-6 h-6" />
                                                </div>
                                                <div className="text-left">
                                                    <div className="font-bold text-lg">{t('dataset.validation_enabled')}</div>
                                                    <div className="text-xs opacity-70 font-normal">{t('dataset.validation_enabled_desc')}</div>
                                                </div>
                                            </>
                                        )}
                                    </button>
                                </div>

                                <div className={`space-y-4 transition-opacity duration-200 ${formData.disable_validation === 'true' ? 'opacity-50 pointer-events-none grayscale' : ''}`}>
                                    {formData.eval_sets.map((set, index) => (
                                        <div key={index} className="grid grid-cols-1 md:grid-cols-12 gap-4 p-4 rounded-xl bg-white/5 border border-white/10 relative group">
                                            <div className="md:col-span-4">
                                                <GlassInput
                                                    label={t('dataset.eval_set_name')}
                                                    helpText={t('help.eval_set_name')}
                                                    value={set.name}
                                                    onChange={(e) => handleEvalSetNameChange(index, e.target.value)}
                                                    disabled={formData.disable_validation === 'true'}
                                                />
                                            </div>
                                            <div className="md:col-span-7 relative">
                                                <GlassInput
                                                    label={t('dataset.input_path')}
                                                    helpText={t('help.dataset_input_path')}
                                                    value={set.path}
                                                    onChange={(e) => handleEvalSetPathChange(index, e.target.value)}
                                                    placeholder={t('dataset.validation_path_placeholder')}
                                                    disabled={formData.disable_validation === 'true'}
                                                />
                                                <button
                                                    type="button"
                                                    onClick={() => handlePickDir((path) => handleEvalSetPathChange(index, path))}
                                                    disabled={formData.disable_validation === 'true'}
                                                    className="absolute right-3 bottom-2.5 p-1 rounded-lg bg-white/5 hover:bg-white/10 text-muted-foreground transition-colors hover:text-primary disabled:opacity-50"
                                                    title={t('project.open')}
                                                >
                                                    <FolderOpen className="w-4 h-4" />
                                                </button>
                                            </div>
                                            <div className="md:col-span-1 flex items-end pb-1.5 justify-end">
                                                <GlassButton
                                                    type="button"
                                                    variant="destructive"
                                                    size="icon"
                                                    onClick={() => removeEvalSet(index)}
                                                    disabled={formData.eval_sets.length <= 1 || formData.disable_validation === 'true'}
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </GlassButton>
                                            </div>
                                        </div>
                                    ))}
                                    <GlassButton
                                        type="button"
                                        variant="outline"
                                        className="w-full border-dashed"
                                        onClick={addEvalSet}
                                        disabled={formData.disable_validation === 'true'}
                                    >
                                        <Plus className="w-4 h-4 mr-2" />
                                        {t('dataset.add_eval_set')}
                                    </GlassButton>
                                </div>
                            </div>
                        )}

                        {isEditingModel && (
                            <div className="col-span-2 space-y-3">
                                <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
                                    {t('dataset.control_path')}
                                </label>
                                {formData.control_paths.map((path, index) => (
                                    <div key={index} className="flex gap-2 items-center">
                                        <div className="flex-1 relative">
                                            <GlassInput
                                                label=""
                                                helpText={t('help.control_path')}
                                                value={path}
                                                onChange={(e) => handleControlPathChange(index, e.target.value)}
                                                placeholder={t('dataset.control_path_placeholder')}
                                            />
                                            <button
                                                type="button"
                                                onClick={() => handlePickDir((p) => handleControlPathChange(index, p))}
                                                className="absolute right-3 bottom-2.5 p-1 rounded-lg bg-white/5 hover:bg-white/10 text-muted-foreground transition-colors hover:text-primary"
                                                title={t('project.open')}
                                            >
                                                <FolderOpen className="w-4 h-4" />
                                            </button>
                                        </div>
                                        {formData.control_paths.length > 1 && (
                                            <GlassButton
                                                type="button"
                                                variant="destructive"
                                                size="icon"
                                                onClick={() => removeControlPath(index)}
                                                className="mt-1"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </GlassButton>
                                        )}
                                    </div>
                                ))}
                                <GlassButton type="button" variant="outline" size="sm" onClick={addControlPath} className="w-full border-dashed">
                                    <Plus className="w-4 h-4 mr-2" />
                                    {t('dataset.add_path')}
                                </GlassButton>
                            </div>
                        )}

                        <GlassInput
                            label={t('dataset.resolutions')}
                            helpText={t('help.resolutions')}
                            name="resolutions"
                            value={formData.resolutions}
                            onChange={handleChange}
                            placeholder={t('dataset.resolutions_placeholder')}
                            disabled={!isTraining && formData.disable_validation === 'true'}
                        />

                        <GlassSelect
                            label={t('dataset.enable_ar_bucket')}
                            helpText={t('help.enable_ar_bucket')}
                            name="enable_ar_bucket"
                            value={formData.enable_ar_bucket}
                            onChange={handleChange}
                            options={[
                                { label: t('dataset.enabled'), value: 'true' },
                                { label: t('dataset.disabled'), value: 'false' }
                            ]}
                            disabled={!isTraining && formData.disable_validation === 'true'}
                        />

                        <GlassInput
                            label={t('dataset.min_ar')}
                            helpText={t('help.min_ar')}
                            name="min_ar"
                            value={formData.min_ar}
                            onChange={handleChange}
                            placeholder="0.5"
                            disabled={!isTraining && formData.disable_validation === 'true'}
                        />

                        <GlassInput
                            label={t('dataset.max_ar')}
                            helpText={t('help.max_ar')}
                            name="max_ar"
                            value={formData.max_ar}
                            onChange={handleChange}
                            placeholder="2.0"
                            disabled={!isTraining && formData.disable_validation === 'true'}
                        />

                        <GlassInput
                            label={t('dataset.num_ar_buckets')}
                            helpText={t('help.num_ar_buckets')}
                            name="num_ar_buckets"
                            type="number"
                            value={formData.num_ar_buckets}
                            onChange={handleChange}
                            disabled={!isTraining && formData.disable_validation === 'true'}
                        />

                        <GlassInput
                            label={t('dataset.num_repeats')}
                            helpText={t('help.num_repeats')}
                            name="num_repeats"
                            type="number"
                            value={formData.num_repeats}
                            onChange={handleChange}
                            disabled={!isTraining && formData.disable_validation === 'true'}
                        />
                    </div>

                    {/* Shuffle Tags and Mask Path Section - Training Only */}
                    {isTraining && (
                        <div className="col-span-2 pt-4 border-t border-white/10">
                            <h4 className="text-lg font-bold mb-4">{t('dataset.shuffle_mask_section')}</h4>
                            <div className="grid gap-4 md:grid-cols-2">
                                <GlassSelect
                                    label={t('dataset.skip_empty_caption')}
                                    helpText={t('help.skip_empty_caption')}
                                    name="skip_empty_caption"
                                    value={formData.skip_empty_caption}
                                    onChange={handleChange}
                                    options={[
                                        { label: t('dataset.skip_empty_caption_on'), value: 'true' },
                                        { label: t('dataset.skip_empty_caption_off'), value: 'false' }
                                    ]}
                                />
                                <GlassInput
                                    label={t('dataset.cache_shuffle_num')}
                                    helpText={t('help.cache_shuffle_num')}
                                    name="cache_shuffle_num"
                                    type="number"
                                    value={formData.cache_shuffle_num}
                                    onChange={handleChange}
                                    placeholder="0"
                                />
                                {Number(formData.cache_shuffle_num) > 0 && (
                                    <GlassInput
                                        label={t('dataset.cache_shuffle_delimiter')}
                                        helpText={t('help.cache_shuffle_delimiter')}
                                        name="cache_shuffle_delimiter"
                                        value={formData.cache_shuffle_delimiter}
                                        onChange={handleChange}
                                        placeholder=", "
                                    />
                                )}
                                <div className="col-span-2 relative">
                                    <GlassInput
                                        label={t('dataset.mask_path')}
                                        helpText={t('help.mask_path')}
                                        name="mask_path"
                                        value={formData.mask_path}
                                        onChange={handleChange}
                                        placeholder={t('dataset.mask_path_placeholder')}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => handlePickDir((path) => setFormData(prev => ({ ...prev, mask_path: path })))}
                                        className="absolute right-3 bottom-2.5 p-1 rounded-lg bg-white/5 hover:bg-white/10 text-muted-foreground transition-colors hover:text-primary"
                                        title={t('project.open')}
                                    >
                                        <FolderOpen className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}

                    <div className="col-span-2 pt-4 border-t border-white/10">
                        <h4 className="text-lg font-bold mb-4">{t('dataset.advanced_buckets')}</h4>
                        <div className="grid gap-4 md:grid-cols-2">
                            <GlassInput
                                label={t('dataset.custom_ar_buckets')}
                                helpText={t('help.ar_buckets')}
                                name="ar_buckets"
                                value={formData.ar_buckets}
                                onChange={handleChange}
                                placeholder={t('dataset.custom_ar_buckets_placeholder')}
                                disabled={!isTraining && formData.disable_validation === 'true'}
                            />
                            {isVideoModel && (
                                <GlassInput
                                    label={t('dataset.frame_buckets')}
                                    helpText={t('help.frame_buckets')}
                                    name="frame_buckets"
                                    value={formData.frame_buckets}
                                    onChange={handleChange}
                                    placeholder={t('dataset.frame_buckets_placeholder')}
                                    disabled={!isTraining && formData.disable_validation === 'true'}
                                />
                            )}
                        </div>
                    </div>

                    <div className="flex justify-end gap-3 pt-4">
                        <GlassButton type="button" variant="destructive" size="lg" onClick={() => setIsResetDialogOpen(true)}>
                            <RotateCcw className="w-4 h-4 mr-2" />
                            {t('common.reset_default')}
                        </GlassButton>
                        <GlassButton
                            type="submit"
                            size="lg"
                            className="pl-6 pr-8 bg-gradient-to-r from-indigo-600 to-purple-600 hover:from-indigo-700 hover:to-purple-700 text-white border-none shadow-lg shadow-indigo-500/20"
                        >
                            <Save className="w-4 h-4 mr-2" />
                            {isTraining ? t('dataset.save') : t('dataset.eval_save')}
                        </GlassButton>
                    </div>
                </form>
            </GlassCard>

            {/* Additional Training Sets UI */}
            {isTraining && (
                <div className="space-y-4">
                    {/* Render additional training set cards */}
                    {formData.train_sets.map((trainSet, index) => (
                        <GlassCard key={index} className="p-6">
                            <div className="flex items-center justify-between mb-4">
                                <h4 className="text-lg font-bold">{t('dataset.extra_training_set')} #{index + 1}</h4>
                                <GlassButton
                                    type="button"
                                    variant="destructive"
                                    size="sm"
                                    onClick={() => removeTrainSet(index)}
                                >
                                    <Trash2 className="w-4 h-4 mr-1" />
                                    {t('common.delete')}
                                </GlassButton>
                            </div>
                            <div className="grid gap-4 md:grid-cols-2">
                                <div className="col-span-2 relative">
                                    <GlassInput
                                        label={t('dataset.input_path')}
                                        value={trainSet.input_path}
                                        onChange={(e) => handleTrainSetPathChange(index, e.target.value)}
                                        placeholder={t('dataset.input_path_placeholder')}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => handlePickDir((path) => handleTrainSetPathChange(index, path))}
                                        className="absolute right-3 bottom-2.5 p-1 rounded-lg bg-white/5 hover:bg-white/10 text-muted-foreground transition-colors hover:text-primary"
                                        title={t('project.open')}
                                    >
                                        <FolderOpen className="w-4 h-4" />
                                    </button>
                                </div>
                                <GlassInput
                                    label={t('dataset.num_repeats')}
                                    type="number"
                                    value={trainSet.num_repeats}
                                    onChange={(e) => handleTrainSetRepeatsChange(index, Number(e.target.value))}
                                />
                                {isEditingModel && (
                                    <div className="col-span-2 space-y-3">
                                        <label className="text-sm font-medium">{t('dataset.control_path')}</label>
                                        {trainSet.control_paths.map((ctrlPath, pathIndex) => (
                                            <div key={pathIndex} className="flex gap-2 items-center">
                                                <div className="flex-1 relative">
                                                    <GlassInput
                                                        label=""
                                                        value={ctrlPath}
                                                        onChange={(e) => handleTrainSetControlPathChange(index, pathIndex, e.target.value)}
                                                        placeholder={t('dataset.control_path_placeholder')}
                                                    />
                                                    <button
                                                        type="button"
                                                        onClick={() => handlePickDir((p) => handleTrainSetControlPathChange(index, pathIndex, p))}
                                                        className="absolute right-3 bottom-2.5 p-1 rounded-lg bg-white/5 hover:bg-white/10 text-muted-foreground transition-colors hover:text-primary"
                                                        title={t('project.open')}
                                                    >
                                                        <FolderOpen className="w-4 h-4" />
                                                    </button>
                                                </div>
                                                {trainSet.control_paths.length > 1 && (
                                                    <GlassButton
                                                        type="button"
                                                        variant="destructive"
                                                        size="icon"
                                                        onClick={() => removeTrainSetControlPath(index, pathIndex)}
                                                        className="mt-1"
                                                    >
                                                        <Trash2 className="w-4 h-4" />
                                                    </GlassButton>
                                                )}
                                            </div>
                                        ))}
                                        <GlassButton type="button" variant="outline" size="sm" onClick={() => addTrainSetControlPath(index)} className="w-full border-dashed">
                                            <Plus className="w-4 h-4 mr-2" />
                                            {t('dataset.add_path')}
                                        </GlassButton>
                                    </div>
                                )}
                            </div>
                        </GlassCard>
                    ))}

                    {/* Add Extra Training Set Button */}
                    <GlassButton
                        type="button"
                        variant="outline"
                        className="w-full border-dashed py-4"
                        onClick={addTrainSet}
                    >
                        <Plus className="w-4 h-4 mr-2" />
                        {t('dataset.add_extra_training_set')}
                    </GlassButton>
                </div>
            )}

            <GlassConfirmDialog
                isOpen={isResetDialogOpen}
                onClose={() => setIsResetDialogOpen(false)}
                onConfirm={handleReset}
                title={t('common.confirm_reset_title')}
                description={t('common.confirm_reset_desc')}
                confirmText={t('common.confirm')}
                cancelText={t('common.cancel')}
            />
            {!isElectron && (
                <WebPathPicker
                    open={webPickerOpen}
                    title={t('web_resources.select_dataset_directory')}
                    mode="directory"
                    allowCreate
                    initialPath={formData.input_path}
                    onClose={() => {
                        setWebPickerOpen(false);
                        webPickCallbackRef.current = null;
                    }}
                    onSelect={(path) => webPickCallbackRef.current?.(path)}
                />
            )}
        </div >
    );
}
