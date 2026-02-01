import React from 'react';
import { GlassCard } from './ui/GlassCard';
import { GlassInput } from './ui/GlassInput';
import { HelpIcon } from './ui/HelpIcon';
// import { GlassSelect } from './ui/GlassSelect'; // Not needed yet
import { useTranslation } from 'react-i18next';

export interface MonitoringConfigProps {
    data: any;
    onChange: (data: any) => void;
}

export function MonitoringConfig({ data, onChange }: MonitoringConfigProps) {
    const { t } = useTranslation();

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const value = e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value;
        onChange({ ...data, [e.target.name]: value });
    };

    return (
        <GlassCard className="p-6">
            <div className="mb-6">
                <h3 className="text-2xl font-bold">{t('monitoring.title')}</h3>
                <p className="text-sm text-muted-foreground">{t('monitoring.desc')}</p>
            </div>

            <div className="flex items-center gap-2 mb-6">
                <input
                    type="checkbox"
                    name="enable_wandb"
                    id="enable_wandb"
                    className="w-4 h-4"
                    checked={!!data.enable_wandb}
                    onChange={handleChange}
                />
                <label htmlFor="enable_wandb" className="text-sm font-medium flex items-center gap-1 cursor-pointer">
                    {t('monitoring.enable_wandb')}
                    <HelpIcon text={t('help.enable_wandb')} />
                </label>
            </div>

            {data.enable_wandb && (
                <div className="grid gap-6 md:grid-cols-3">
                    <GlassInput
                        label={t('monitoring.wandb_api_key')}
                        name="wandb_api_key"
                        value={data.wandb_api_key ?? ''}
                        onChange={handleChange}
                        type="password"
                        placeholder="WandB API Key"
                    />
                    <GlassInput
                        label={t('monitoring.wandb_tracker_name')}
                        name="wandb_tracker_name"
                        value={data.wandb_tracker_name ?? ''}
                        onChange={handleChange}
                        placeholder="Tracker/Project Name"
                    />
                    <GlassInput
                        label={t('monitoring.wandb_run_name')}
                        name="wandb_run_name"
                        value={data.wandb_run_name ?? ''}
                        onChange={handleChange}
                        placeholder="Run Name (Optional)"
                    />
                </div>
            )}
        </GlassCard>
    );
}
