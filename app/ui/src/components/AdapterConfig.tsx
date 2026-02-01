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
        onChange({ ...data, [e.target.name]: e.target.value });
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

    const PathInput = ({ label, name, placeholder, isFolder = false }: { label: string, name: string, placeholder?: string, isFolder?: boolean }) => (
        <div className="relative">
            <GlassInput
                label={label}
                name={name}
                value={data[name] ?? ''}
                onChange={handleChange}
                placeholder={placeholder}
            />
            <button
                type="button"
                onClick={() => handlePickPath(name, isFolder)}
                className="absolute right-3 bottom-2.5 p-1 rounded-lg bg-white/5 hover:bg-white/10 text-muted-foreground transition-colors hover:text-primary"
                title={t('project.open')}
            >
                <FolderOpen className="w-4 h-4" />
            </button>
        </div>
    );

    const adapterOptions = [
        { label: 'LoRA', value: 'lora' },
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
                <p className="text-sm text-muted-foreground">{t('adapter.desc')}</p>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                <GlassSelect
                    label={t('adapter.type')}
                    name="adapter_type"
                    value={data.adapter_type ?? 'lora'}
                    onChange={handleChange}
                    options={adapterOptions}
                />
                <GlassInput label={t('adapter.rank')} helpText={t('help.rank')} name="rank" type="number" value={data.rank ?? 32} onChange={handleChange} />
                <GlassSelect
                    label={t('adapter.dtype')}
                    helpText={t('help.dtype')}
                    name="dtype"
                    value={data.dtype ?? 'bfloat16'}
                    onChange={handleChange}
                    options={dtypeOptions}
                />
                <PathInput label={t('adapter.init_from')} name="init_from_existing" placeholder="/path/to/existing_lora" />
            </div>
        </GlassCard>
    );
}
