import React from 'react';
import { GlassCard } from './ui/GlassCard';
import { GlassInput } from './ui/GlassInput';
import { GlassSelect } from './ui/GlassSelect';
import { useTranslation } from 'react-i18next';
import { HelpIcon } from './ui/HelpIcon';

export interface OptimizerConfigProps {
    data: any;
    onChange: (data: any) => void;
}

export function OptimizerConfig({ data, onChange }: OptimizerConfigProps) {
    const { t } = useTranslation();

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value, type } = e.target;
        const val = type === 'checkbox' ? (e.target as HTMLInputElement).checked : value;
        let newData = { ...data, [name]: val };

        // Handle Optimizer Type Changes
        if (name === 'optimizer_type') {
            if (value === 'Prodigy') {
                newData.lr = '1';
            }
            // For Automagic we don't necessarily need to clear values immediately, 
            // as they will be filtered out during save/config construction if we implement that logic.
            // But visually they are hidden.
        }

        onChange(newData);
    };

    const optimizerOptions = [
        { label: 'AdamW Optimi', value: 'adamw_optimi' },
        { label: 'Automagic', value: 'automagic' },
        { label: 'Prodigy', value: 'Prodigy' },
        { label: 'AdamW 8bit Kahan', value: 'AdamW8bitKahan' }
    ];

    return (
        <GlassCard className="p-6">
            <div className="mb-6">
                <h3 className="text-2xl font-bold">{t('optimizer.title')}</h3>
                <p className="text-sm text-muted-foreground">{t('optimizer.desc')}</p>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
                <GlassSelect
                    label={t('optimizer.type')}
                    name="optimizer_type"
                    value={data.optimizer_type ?? 'adamw_optimi'}
                    onChange={handleChange}
                    options={optimizerOptions}
                />

                {data.optimizer_type !== 'automagic' && (
                    <>
                        <GlassInput
                            label={t('optimizer.lr')}
                            helpText={t('help.lr')}
                            name="lr"
                            type="text"
                            value={data.optimizer_type === 'Prodigy' ? '1' : (data.lr ?? '2e-5')}
                            onChange={handleChange}
                            disabled={data.optimizer_type === 'Prodigy'}
                            className={data.optimizer_type === 'Prodigy' ? 'opacity-70 cursor-not-allowed' : ''}
                        />
                    </>
                )}

                <GlassInput
                    label={t('optimizer.weight_decay')}
                    helpText={t('help.weight_decay')}
                    name="weight_decay"
                    type="text"
                    value={data.weight_decay ?? '0.01'}
                    onChange={handleChange}
                />

                {data.optimizer_type !== 'automagic' && (
                    <>
                        <GlassInput
                            label={t('optimizer.beta1')}
                            helpText={t('help.beta1')}
                            name="beta1"
                            type="text"
                            value={data.beta1 ?? '0.9'}
                            onChange={handleChange}
                        />
                        <GlassInput
                            label={t('optimizer.beta2')}
                            helpText={t('help.beta2')}
                            name="beta2"
                            type="text"
                            value={data.beta2 ?? '0.99'}
                            onChange={handleChange}
                        />
                        <GlassInput
                            label={t('optimizer.eps')}
                            helpText={t('help.eps')}
                            name="eps"
                            type="text"
                            value={data.eps ?? '1e-8'}
                            onChange={handleChange}
                        />
                    </>
                )}

                {data.optimizer_type === 'AdamW8bitKahan' && (
                    <div className="flex items-center gap-2 mt-8">
                        <input
                            type="checkbox"
                            name="stabilize"
                            id="stabilize"
                            className="w-4 h-4"
                            checked={!!data.stabilize}
                            onChange={handleChange}
                        />
                        <label htmlFor="stabilize" className="text-sm flex items-center gap-1 cursor-pointer">
                            {t('optimizer.stabilize')}
                            <HelpIcon text={t('help.stabilize')} />
                        </label>
                    </div>
                )}
            </div>
        </GlassCard>
    );
}

// Effect to enforce Prodigy LR and clear Automagic values would be better handled in parent or onChange
// But for simplicty in UI, we just control rendering and value passing above.
// However, to ensure the state reflects '1' for Prodigy, we should update it if it's not.
// Let's implement a useEffect for side effects.
