import React from 'react';
import { isElectron } from '@/lib/ipc';
import { webFiles, WebRootsResponse } from '@/lib/webFiles';
import { GlassCard } from './ui/GlassCard';
import { GlassInput } from './ui/GlassInput';
import { GlassSelect } from './ui/GlassSelect';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, Database, FolderOpen, Loader2 } from 'lucide-react';
import { HelpIcon } from './ui/HelpIcon';
import { GlassButton } from './ui/GlassButton';
import { WebPathPicker } from './ui/WebPathPicker';

export interface TrainingConfigProps {
    data: any;
    modelType?: string;
    onChange: (data: any) => void;
    validationEnabled?: boolean;
}

export function TrainingConfig({ data, modelType, onChange, validationEnabled = true }: TrainingConfigProps) {
    const { t } = useTranslation();
    const [roots, setRoots] = React.useState<WebRootsResponse | null>(null);
    const [pickerOpen, setPickerOpen] = React.useState(false);
    const [preparingOutput, setPreparingOutput] = React.useState(false);
    const [outputError, setOutputError] = React.useState('');

    React.useEffect(() => {
        if (isElectron) return;
        void webFiles.roots().then(setRoots).catch((reason) => {
            setOutputError(reason instanceof Error ? reason.message : String(reason));
        });
    }, []);

    const isVideoModel = ['hunyuan_video', 'ltx_video', 'ltx2', 'wan21', 'wan22', 'hunyuan_video_15', 'cosmos', 'minimax_h3'].includes(modelType || '');
    const isMiniMaxH3 = modelType === 'minimax_h3';

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        onChange({ ...data, [e.target.name]: e.target.value });
    };

    const useRecommendedOutput = async () => {
        if (!roots?.recommendedOutputBase.writable) return;
        setPreparingOutput(true);
        setOutputError('');
        try {
            const result = await webFiles.ensureDirectory(roots.recommendedOutputBase.path);
            onChange({ ...data, output_base_dir: result.path });
        } catch (reason) {
            setOutputError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            setPreparingOutput(false);
        }
    };

    const useSelectedOutput = async (path: string) => {
        setPreparingOutput(true);
        setOutputError('');
        try {
            const result = await webFiles.ensureDirectory(path);
            onChange({ ...data, output_base_dir: result.path });
        } catch (reason) {
            setOutputError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            setPreparingOutput(false);
        }
    };

    return (
        <div className="space-y-6">
            <GlassCard className="p-6">
                <div className="mb-6">
                    <h3 className="text-2xl font-bold">{t('training.title')}</h3>
                    <p className="text-sm text-muted-foreground">{t('training.desc')}</p>
                </div>

                <div className="grid gap-6 md:grid-cols-3">
                    {!isElectron && (
                        <div className="md:col-span-3 rounded-xl border border-primary/20 bg-primary/5 p-4 space-y-3">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div>
                                    <div className="font-semibold flex items-center gap-2"><Database className="w-4 h-4" />{t('web_resources.output_base')}</div>
                                    <div className="text-xs text-muted-foreground mt-1">{t('web_resources.output_base_hint')}</div>
                                </div>
                                <div className="flex gap-2">
                                    {roots?.recommendedOutputBase.writable && (
                                        <GlassButton type="button" size="sm" variant="outline" onClick={() => void useRecommendedOutput()} disabled={preparingOutput}>
                                            {preparingOutput ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Database className="w-4 h-4 mr-2" />}
                                            {t('web_resources.use_recommended')}
                                        </GlassButton>
                                    )}
                                    <GlassButton type="button" size="sm" variant="outline" onClick={() => setPickerOpen(true)}>
                                        <FolderOpen className="w-4 h-4 mr-2" />{t('common.browse')}
                                    </GlassButton>
                                </div>
                            </div>
                            <div className="rounded-lg bg-black/15 border border-white/10 px-3 py-2 font-mono text-sm break-all">
                                {data.output_base_dir || t('web_resources.output_project_default')}
                            </div>
                            {roots && (
                                <div className="text-xs text-muted-foreground">
                                    {t('web_resources.recommended')}: {roots.recommendedOutputBase.path} · {t(`web_resources.storage_${roots.recommendedOutputBase.storageKind}`)}
                                    {!roots.recommendedOutputBase.exists && ` · ${t('web_resources.created_on_confirm')}`}
                                </div>
                            )}
                            {outputError && <div className="text-sm text-red-400">{outputError}</div>}
                        </div>
                    )}
                    <GlassInput label={t('training.output_name')} helpText={t('help.output_name')} name="output_folder_name" value={data.output_folder_name ?? 'mylora'} onChange={handleChange} />
                    <GlassInput label={t('training.epochs')} helpText={t('help.epochs')} name="epochs" type="number" value={data.epochs ?? 50} onChange={handleChange} />
                    <GlassInput label={t('training.batch_size')} helpText={t('help.micro_batch_size_per_gpu')} name="micro_batch_size_per_gpu" type="number" value={data.micro_batch_size_per_gpu ?? 1} onChange={handleChange} />
                    <GlassInput label={t('training.image_micro_batch_size_per_gpu')} helpText={t('help.image_micro_batch_size_per_gpu')} name="image_micro_batch_size_per_gpu" type="number" value={data.image_micro_batch_size_per_gpu ?? ''} onChange={handleChange} placeholder={data.micro_batch_size_per_gpu ?? 1} />

                    <GlassInput label={t('training.grad_accumulation')} helpText={t('help.gradient_accumulation_steps')} name="gradient_accumulation_steps" type="number" value={data.gradient_accumulation_steps ?? 3} onChange={handleChange} />
                    <GlassInput label={t('training.warmup_steps')} helpText={t('help.warmup_steps')} name="warmup_steps" type="number" min="0" value={data.warmup_steps ?? 500} onChange={handleChange} />

                    <GlassSelect
                        label={t('training.lr_scheduler')}
                        helpText={t('help.lr_scheduler')}
                        name="lr_scheduler"
                        value={data.lr_scheduler ?? 'linear'}
                        onChange={handleChange}
                        options={[
                            { label: 'Constant', value: 'constant' },
                            { label: 'Linear', value: 'linear' },
                            { label: 'Cosine', value: 'cosine' }
                        ]}
                    />

                    <GlassInput label={t('training.grad_clipping')} helpText={t('help.grad_clipping')} name="gradient_clipping" type="number" step="0.1" value={data.gradient_clipping ?? 1.0} onChange={handleChange} />

                    <GlassSelect
                        label={t('training.save_dtype')}
                        helpText={t('help.save_dtype')}
                        name="save_dtype"
                        value={data.save_dtype ?? 'bfloat16'}
                        onChange={handleChange}
                        options={[{ label: 'bfloat16', value: 'bfloat16' }, { label: 'float16', value: 'float16' }, { label: 'float32', value: 'float32' }]}
                    />

                    <GlassSelect
                        label={t('training.partition_method')}
                        helpText={t('help.partition_method')}
                        name="partition_method"
                        value={data.partition_method ?? 'parameters'}
                        onChange={handleChange}
                        options={[{ label: 'parameters', value: 'parameters' }, { label: 'uniform', value: 'uniform' }, { label: 'memory', value: 'memory' }]}
                    />

                    <GlassSelect
                        label={t('training.activation_checkpointing')}
                        helpText={t('help.activation_checkpointing')}
                        name="activation_checkpointing"
                        value={data.activation_checkpointing ?? 'true'}
                        onChange={handleChange}
                        options={[
                            { label: t('dataset.enabled'), value: 'true' },
                            { label: t('dataset.disabled'), value: 'false' },
                            { label: t('training.activation_checkpointing_unsloth'), value: 'unsloth' }
                        ]}
                    />

                    <GlassInput label={t('training.pipeline_stages')} helpText={t('help.pipeline_stages')} name="pipeline_stages" type="number" value={data.pipeline_stages ?? 1} onChange={handleChange} />
                    <GlassInput label={t('training.blocks_to_swap')} helpText={isMiniMaxH3 ? t('help.minimax_blocks_to_swap') : t('help.blocks_to_swap')} name="blocks_to_swap" type="number" min={0} max={isMiniMaxH3 ? 48 : undefined} value={data.blocks_to_swap ?? 0} onChange={handleChange} />
                    <GlassInput label={t('training.caching_batch_size')} helpText={t('help.caching_batch_size')} name="caching_batch_size" type="number" value={data.caching_batch_size ?? 1} onChange={handleChange} />

                    {isVideoModel && (
                        <GlassSelect
                            label={t('training.video_clip_mode')}
                            helpText={t('help.video_clip_mode')}
                            name="video_clip_mode"
                            value={data.video_clip_mode ?? 'single_beginning'}
                            onChange={handleChange}
                            options={[
                                { label: 'Single Beginning', value: 'single_beginning' },
                                { label: 'Single Middle', value: 'single_middle' }
                            ]}
                        />
                    )}

                    <GlassInput label={t('training.steps_per_print')} helpText={t('help.steps_per_print')} name="steps_per_print" type="number" value={data.steps_per_print ?? 1} onChange={handleChange} />
                    <GlassInput label={t('training.save_every_n_epochs')} helpText={t('help.save_every_n_epochs')} name="save_every_n_epochs" type="number" value={data.save_every_n_epochs ?? 1} onChange={handleChange} />
                    <GlassInput label={t('training.checkpoint_every_n_minutes')} helpText={t('help.checkpoint_every_n_minutes')} name="checkpoint_every_n_minutes" type="number" value={data.checkpoint_every_n_minutes ?? 120} onChange={handleChange} />

                    <div className="md:col-span-3 border-t border-white/10 my-4 pt-4">
                        <h4 className="text-lg font-semibold mb-4 text-muted-foreground">{t('training.eval_settings')}</h4>

                        {!validationEnabled ? (
                            <div className="p-4 rounded-xl bg-white/5 border border-white/10 flex items-center gap-3 text-yellow-500/80">
                                <AlertTriangle className="w-5 h-5 flex-shrink-0" />
                                <span className="text-sm">{t('training.validation_disabled_hint')}</span>
                            </div>
                        ) : (
                            <div className="grid gap-6 md:grid-cols-3">
                                <GlassInput label={t('training.eval_every_n_epochs')} helpText={t('help.eval_every_n_epochs')} name="eval_every_n_epochs" type="number" value={data.eval_every_n_epochs ?? 1} onChange={handleChange} />
                                <GlassInput label={t('advanced_training.eval_every_n_steps')} helpText={t('help.eval_every_n_steps')} name="eval_every_n_steps" type="number" value={data.eval_every_n_steps ?? 0} onChange={handleChange} />
                                <GlassInput label={t('training.eval_batch_size')} helpText={t('help.eval_batch_size')} name="eval_micro_batch_size_per_gpu" type="number" value={data.eval_micro_batch_size_per_gpu ?? 1} onChange={handleChange} />
                                <GlassInput label={t('training.image_eval_micro_batch_size_per_gpu')} helpText={t('help.image_eval_micro_batch_size_per_gpu')} name="eval_image_micro_batch_size_per_gpu" type="number" value={data.eval_image_micro_batch_size_per_gpu ?? ''} onChange={handleChange} placeholder={data.eval_micro_batch_size_per_gpu ?? 1} />
                                <GlassInput label={t('training.eval_grad_accumulation')} helpText={t('help.eval_gradient_accumulation_steps')} name="eval_gradient_accumulation_steps" type="number" value={data.eval_gradient_accumulation_steps ?? 1} onChange={handleChange} />

                                <div className="flex items-center gap-6 mt-8">
                                    <div className="flex items-center gap-2">
                                        <input type="checkbox" name="eval_before_first_step" id="eval_before_first_step" className="w-4 h-4" checked={data.eval_before_first_step !== false} onChange={(e) => onChange({ ...data, eval_before_first_step: e.target.checked })} />
                                        <label htmlFor="eval_before_first_step" className="text-sm flex items-center gap-1 cursor-pointer">
                                            {t('training.eval_before_first_step')}
                                            <HelpIcon text={t('help.eval_before_first_step')} />
                                        </label>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <input type="checkbox" name="disable_block_swap_for_eval" id="disable_block_swap_for_eval" className="w-4 h-4" checked={!!data.disable_block_swap_for_eval} onChange={(e) => onChange({ ...data, disable_block_swap_for_eval: e.target.checked })} />
                                        <label htmlFor="disable_block_swap_for_eval" className="text-sm flex items-center gap-1 cursor-pointer">
                                            {t('training.disable_block_swap_for_eval')}
                                            <HelpIcon text={t('help.disable_block_swap_for_eval')} />
                                        </label>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </GlassCard>
            {!isElectron && (
                <WebPathPicker
                    open={pickerOpen}
                    title={t('web_resources.select_output_base')}
                    mode="directory"
                    allowCreate
                    writableOnly
                    initialPath={data.output_base_dir || roots?.recommendedOutputBase.path}
                    onClose={() => setPickerOpen(false)}
                    onSelect={(path) => void useSelectedOutput(path)}
                />
            )}
        </div>
    );
}
