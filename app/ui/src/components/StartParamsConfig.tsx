import React from 'react';
import { GlassCard } from './ui/GlassCard';
import { GlassInput } from './ui/GlassInput';
import { HelpIcon } from './ui/HelpIcon';
import { useTranslation } from 'react-i18next';
import { FolderOpen } from 'lucide-react';

export interface StartParamsConfigProps {
    data: any;
    onChange: (data: any) => void;
}

export function StartParamsConfig({ data, onChange }: StartParamsConfigProps) {
    const { t } = useTranslation();
    const [platform, setPlatform] = React.useState<string>('');

    React.useEffect(() => {
        const fetchPlatform = async () => {
            try {
                // @ts-ignore
                const p = await window.ipcRenderer.invoke('get-platform');
                setPlatform(p);
            } catch (e) {
                console.error("Failed to fetch platform:", e);
            }
        };
        fetchPlatform();
    }, []);

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
        onChange({ ...data, [e.target.name]: value });
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

    const PathInput = ({ label, helpText, name, placeholder, isFolder = false, className }: { label: string, helpText?: string, name: string, placeholder?: string, isFolder?: boolean, className?: string }) => (
        <div className={`relative ${className}`}>
            <GlassInput
                label={label}
                helpText={helpText}
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

    return (
        <GlassCard className="p-6">
            <div className="mb-6">
                <h3 className="text-2xl font-bold">{t('start_params.title')}</h3>
                <p className="text-sm text-muted-foreground">{t('start_params.desc')}</p>
            </div>

            <div className="grid gap-6 md:grid-cols-2">
                <PathInput
                    label={t('start_params.resume_from_checkpoint')}
                    helpText={t('help.resume_from_checkpoint')}
                    name="resume_from_checkpoint"
                    placeholder="C:\ComfyUI\20260127_18-57-41\global_step900"
                    isFolder={true}
                    className="md:col-span-2"
                />

                <PathInput
                    label={t('start_params.dump_dataset')}
                    name="dump_dataset"
                    placeholder="C:\debug\dataset"
                    isFolder={true}
                    className="md:col-span-2"
                />

                <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-2">
                        <input type="checkbox" name="regenerate_cache" id="regenerate_cache" className="w-4 h-4" checked={!!data.regenerate_cache} onChange={handleChange} />
                        <label htmlFor="regenerate_cache" className="text-sm flex items-center gap-1 cursor-pointer">
                            {t('start_params.regenerate_cache')}
                            <HelpIcon text={t('help.regenerate_cache')} />
                        </label>
                    </div>
                    <div className="flex items-center gap-2">
                        <input type="checkbox" name="trust_cache" id="trust_cache" className="w-4 h-4" checked={!!data.trust_cache} onChange={handleChange} />
                        <label htmlFor="trust_cache" className="text-sm flex items-center gap-1 cursor-pointer">
                            {t('start_params.trust_cache')}
                            <HelpIcon text={t('help.trust_cache')} />
                        </label>
                    </div>
                    <div className="flex items-center gap-2">
                        <input type="checkbox" name="cache_only" className="w-4 h-4" checked={!!data.cache_only} onChange={handleChange} />
                        <label className="text-sm">{t('start_params.cache_only')}</label>
                    </div>
                </div>

                <div className="flex flex-col gap-4">
                    <div className="flex items-center gap-2">
                        <input type="checkbox" name="reset_dataloader" className="w-4 h-4" checked={!!data.reset_dataloader} onChange={handleChange} />
                        <label className="text-sm">{t('start_params.reset_dataloader')}</label>
                    </div>
                    <div className="flex items-center gap-2">
                        <input type="checkbox" name="reset_optimizer_params" className="w-4 h-4" checked={!!data.reset_optimizer_params} onChange={handleChange} />
                        <label className="text-sm">{t('start_params.reset_optimizer_params')}</label>
                    </div>
                    <div className="flex items-center gap-2">
                        <input type="checkbox" name="i_know_what_i_am_doing" className="w-4 h-4" checked={!!data.i_know_what_i_am_doing} onChange={handleChange} />
                        <label className="text-sm text-red-400 font-medium">{t('start_params.i_know_what_i_am_doing')}</label>
                    </div>

                    {platform !== 'win32' && (
                        <div className="mt-2">
                            <GlassInput
                                label={t('start_params.num_gpus')}
                                helpText={t('help.num_gpus')}
                                name="num_gpus"
                                type="number"
                                min={1}
                                value={data.num_gpus ?? 1}
                                onChange={handleChange}
                            />
                        </div>
                    )}
                </div>
            </div>
        </GlassCard>
    );
}
