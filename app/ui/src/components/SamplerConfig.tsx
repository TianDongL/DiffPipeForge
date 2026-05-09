
import { GlassCard } from './ui/GlassCard';
import { GlassInput } from './ui/GlassInput';
import { GlassSelect } from './ui/GlassSelect';
import { useTranslation } from 'react-i18next';
import { HelpIcon } from './ui/HelpIcon';
import { Plus, Trash2 } from 'lucide-react';

export interface SamplerConfigProps {
    data: any[];
    onChange: (data: any[]) => void;
}

export const DEFAULT_SAMPLER_ITEM = {
    width: 512,
    height: 512,
    guidance_scale: 5.0,
    seed: 42,
    sampler_name: 'euler',
    sample_every_n_epochs: 1,
    sample_prompt: ''
};

export function SamplerConfig({ data, onChange }: SamplerConfigProps) {
    const { t } = useTranslation();

    const handleAddSampler = () => {
        onChange([...data, { ...DEFAULT_SAMPLER_ITEM }]);
    };

    const handleRemoveSampler = (index: number) => {
        const newData = [...data];
        newData.splice(index, 1);
        onChange(newData);
    };

    const handleChange = (index: number, field: string, value: any) => {
        const newData = [...data];
        newData[index] = { ...newData[index], [field]: value };
        onChange(newData);
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-2xl font-bold flex items-center gap-2">
                        {t('sampler.title', 'Native Preview Sampler')}
                    </h3>
                    <p className="text-sm text-muted-foreground mt-1">
                        {t('sampler.desc', 'Automatically generate preview images during training without external tools.')}
                    </p>
                </div>
                <button
                    onClick={handleAddSampler}
                    type="button"
                    className="flex items-center gap-2 px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-lg text-sm font-medium transition-colors"
                >
                    <Plus className="w-4 h-4" />
                    {t('sampler.add_sampler', 'Add Preview Task')}
                </button>
            </div>

            {data.length === 0 ? (
                <GlassCard className="p-8 text-center text-muted-foreground">
                    <p>{t('sampler.no_samplers', 'No preview tasks configured. Click "Add Preview Task" to create one.')}</p>
                </GlassCard>
            ) : (
                data.map((item, index) => (
                    <GlassCard key={index} className="p-6 border-l-4 border-l-indigo-500 relative">
                        <div className="absolute top-4 right-4 text-xs font-mono text-white/30">
                            ID: {index}
                        </div>
                        <div className="flex justify-between items-center mb-6">
                            <h4 className="text-lg font-semibold text-white/90">
                                {t('sampler.task_label', 'Preview Queue')} #{index + 1}
                            </h4>
                            <button
                                onClick={() => handleRemoveSampler(index)}
                                type="button"
                                className="p-2 text-white/40 hover:text-red-400 hover:bg-red-400/10 rounded-lg transition-colors"
                                title={t('common.delete', 'Delete')}
                            >
                                <Trash2 className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
                            <GlassInput
                                label={t('sampler.sample_every_n_epochs')}
                                helpText={t('help.sampler_every_n_epochs')}
                                name={`epochs_${index}`}
                                type="number"
                                value={item.sample_every_n_epochs ?? ''}
                                onChange={(e) => handleChange(index, 'sample_every_n_epochs', e.target.value)}
                            />
                            <GlassInput
                                label={t('sampler.sample_every_n_steps')}
                                helpText={t('help.sampler_every_n_steps')}
                                name={`steps_${index}`}
                                type="number"
                                value={item.sample_every_n_steps ?? ''}
                                onChange={(e) => handleChange(index, 'sample_every_n_steps', e.target.value)}
                            />

                            <div className="md:col-span-2 lg:col-span-3">
                                <label className="text-sm font-medium text-gray-200 flex items-center gap-1 mb-2">
                                    {t('sampler.sample_prompt')}
                                    <HelpIcon text={t('help.sampler_prompt')} />
                                </label>
                                <textarea
                                    className="w-full h-24 bg-black/20 border border-white/10 rounded-lg p-3 text-sm text-gray-300 placeholder:text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 resize-y"
                                    value={item.sample_prompt ?? ''}
                                    onChange={(e) => handleChange(index, 'sample_prompt', e.target.value)}
                                    placeholder={t('sampler.prompt_placeholder', 'Enter your prompt here...')}
                                />
                            </div>

                            <GlassInput
                                label={t('sampler.width')}
                                helpText={t('help.sampler_width')}
                                name={`width_${index}`}
                                type="number"
                                value={item.width ?? 512}
                                onChange={(e) => handleChange(index, 'width', e.target.value)}
                            />
                            <GlassInput
                                label={t('sampler.height')}
                                helpText={t('help.sampler_height')}
                                name={`height_${index}`}
                                type="number"
                                value={item.height ?? 512}
                                onChange={(e) => handleChange(index, 'height', e.target.value)}
                            />
                            <GlassInput
                                label={t('sampler.guidance_scale')}
                                helpText={t('help.sampler_guidance_scale')}
                                name={`cfg_${index}`}
                                type="number"
                                step="0.1"
                                value={item.guidance_scale ?? 5.0}
                                onChange={(e) => handleChange(index, 'guidance_scale', e.target.value)}
                            />
                            <GlassInput
                                label={t('sampler.seed')}
                                helpText={t('help.sampler_seed')}
                                name={`seed_${index}`}
                                type="number"
                                value={item.seed ?? 42}
                                onChange={(e) => handleChange(index, 'seed', e.target.value)}
                            />

                            <GlassSelect
                                label={t('sampler.sampler_name')}
                                helpText={t('help.sampler_name')}
                                name={`sampler_${index}`}
                                value={item.sampler_name ?? 'euler'}
                                onChange={(e) => handleChange(index, 'sampler_name', e.target.value)}
                                options={[
                                    { label: 'euler', value: 'euler' },
                                    { label: 'euler_ancestral', value: 'euler_ancestral' },
                                    { label: 'flowmatch', value: 'flowmatch' },
                                    { label: 'dpm_2', value: 'dpm_2' },
                                    { label: 'dpm_2_ancestral', value: 'dpm_2_ancestral' },
                                    { label: 'lms', value: 'lms' }
                                ]}
                            />
                        </div>
                    </GlassCard>
                ))
            )}
        </div>
    );
}
