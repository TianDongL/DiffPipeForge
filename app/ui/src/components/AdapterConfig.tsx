import { ipc } from '@/lib/ipc';
import React from 'react';
import { GlassCard } from './ui/GlassCard';
import { GlassInput } from './ui/GlassInput';
import { GlassSelect } from './ui/GlassSelect';
import { useTranslation } from 'react-i18next';
import { FolderOpen } from 'lucide-react';

export interface AdapterConfigProps {
    data: any;
    onChange: (data: any) => void;
}

export function AdapterConfig({ data, onChange }: AdapterConfigProps) {
    const { t } = useTranslation();

    const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
        const { name, value } = e.target;

        if (name === 'adapter_type') {
            if (value === 'lokr') {
                onChange({
                    ...data,
                    adapter_type: value,
                    rank: data.adapter_type === 'lokr' ? (data.rank ?? 1000000) : 1000000,
                    decompose_factor: data.decompose_factor ?? 4,
                    dtype: data.dtype ?? 'bfloat16'
                });
                return;
            }

            if (value === 'lora') {
                onChange({
                    ...data,
                    adapter_type: value,
                    rank: data.adapter_type === 'lora' ? (data.rank ?? 32) : 32,
                    dropout: data.dropout ?? 0.0,
                    dtype: data.dtype ?? 'bfloat16'
                });
                return;
            }
        }

        onChange({ ...data, [name]: value });
    };

    const handlePickPath = async (name: string, isFolder: boolean = false) => {
        try {
            // @ts-ignore
            const result = await ipc.invoke('dialog:openFile', {
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

    const PathInput = ({ label, helpText, name, placeholder, isFolder = false, disabled = false }: { label: string, helpText?: string, name: string, placeholder?: string, isFolder?: boolean, disabled?: boolean }) => (
        <div className={`relative ${disabled ? 'opacity-50 pointer-events-none' : ''}`}>
            <GlassInput
                label={label}
                helpText={helpText}
                name={name}
                value={data[name] ?? ''}
                onChange={handleChange}
                placeholder={placeholder}
                disabled={disabled}
            />
            <button
                type="button"
                onClick={() => !disabled && handlePickPath(name, isFolder)}
                className="absolute right-3 bottom-2.5 p-1 rounded-lg bg-white/5 hover:bg-white/10 text-muted-foreground transition-colors hover:text-primary"
                title={t('project.open')}
                disabled={disabled}
            >
                <FolderOpen className="w-4 h-4" />
            </button>
        </div>
    );

    const adapterOptions = [
        { label: 'LoRA', value: 'lora' },
        { label: 'LoKr', value: 'lokr' },
        { label: 'None (全量微调)', value: 'none' }
    ];

    const dtypeOptions = [
        { label: 'bfloat16', value: 'bfloat16' },
        { label: 'float16', value: 'float16' },
        { label: 'float32', value: 'float32' }
    ];

    return (
        <GlassCard className="p-6">
            <div className="mb-6">
                <h3 className="text-2xl font-bold">{t('adapter.title')}</h3>
                <p className="text-sm text-muted-foreground mb-4">{t('adapter.desc')}</p>
                {data.adapter_type === 'none' && (
                    <div className="p-3 rounded-lg bg-blue-500/10 border border-blue-500/20 text-blue-300 text-sm animate-in fade-in slide-in-from-top-1 duration-300">
                        {t('adapter.fft_hint')}
                    </div>
                )}
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                <GlassSelect
                    label={t('adapter.type')}
                    helpText={t('help.adapter_type')}
                    name="adapter_type"
                    value={data.adapter_type ?? 'lora'}
                    onChange={handleChange}
                    options={adapterOptions}
                />
                <GlassInput
                    label={t('adapter.rank')}
                    helpText={data.adapter_type === 'lokr' ? t('help.lokr_rank') : t('help.rank')}
                    name="rank"
                    type="number"
                    value={data.rank ?? 32}
                    onChange={handleChange}
                    disabled={data.adapter_type === 'none'}
                    className={data.adapter_type === 'none' ? 'opacity-50' : ''}
                />
                {data.adapter_type === 'lokr' ? (
                    <GlassInput
                        label={t('adapter.decompose_factor')}
                        helpText={t('help.decompose_factor')}
                        name="decompose_factor"
                        type="number"
                        step="1"
                        min="1"
                        value={data.decompose_factor ?? 4}
                        onChange={handleChange}
                    />
                ) : (
                    <GlassInput
                        label={t('adapter.dropout')}
                        helpText={t('help.dropout')}
                        name="dropout"
                        type="number"
                        step="0.01"
                        min="0"
                        max="1"
                        value={data.dropout ?? 0.0}
                        onChange={handleChange}
                        disabled={data.adapter_type === 'none'}
                        className={data.adapter_type === 'none' ? 'opacity-50' : ''}
                    />
                )}
                <GlassSelect
                    label={t('adapter.dtype')}
                    helpText={t('help.dtype')}
                    name="dtype"
                    value={data.dtype ?? 'bfloat16'}
                    onChange={handleChange}
                    options={dtypeOptions}
                    disabled={data.adapter_type === 'none'}
                    className={data.adapter_type === 'none' ? 'opacity-50' : ''}
                />
                <PathInput
                    label={t('adapter.init_from')}
                    helpText={t('help.init_from_existing')}
                    name="init_from_existing"
                    placeholder="/path/to/existing_lora"
                    disabled={data.adapter_type === 'none'}
                />
            </div>
        </GlassCard>
    );
}
