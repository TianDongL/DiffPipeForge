import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Loader2, UploadCloud, Video } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatBytes, webFiles, WebRootsResponse } from '@/lib/webFiles';
import { GlassButton } from './ui/GlassButton';

interface WebDatasetUploadProps {
    onUploaded: (path: string) => void;
    onBusyChange?: (busy: boolean) => void;
    datasetType?: 'training' | 'validation';
    disabled?: boolean;
}

const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'mkv', 'webm', 'avi']);

function isCaptionFile(name: string): boolean {
    return name.endsWith('.txt');
}

function extension(name: string): string {
    return name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
}

function stem(name: string): string {
    const index = name.lastIndexOf('.');
    // The Linux loader resolves captions with Path.with_suffix('.txt'), so
    // Foo.mp4 must be paired with Foo.txt (not foo.txt).
    return index > 0 ? name.slice(0, index) : name;
}

export function WebDatasetUpload({ onUploaded, onBusyChange, datasetType = 'training', disabled = false }: WebDatasetUploadProps) {
    const { t } = useTranslation();
    const [roots, setRoots] = useState<WebRootsResponse | null>(null);
    const [files, setFiles] = useState<File[]>([]);
    const [busy, setBusy] = useState(false);
    const [sentBytes, setSentBytes] = useState(0);
    const [error, setError] = useState('');
    const [completedPath, setCompletedPath] = useState('');
    const isValidation = datasetType === 'validation';

    useEffect(() => {
        void webFiles.roots().then(setRoots).catch((reason) => {
            setError(reason instanceof Error ? reason.message : String(reason));
        });
    }, []);

    const selection = useMemo(() => {
        const videos = files.filter((file) => VIDEO_EXTENSIONS.has(extension(file.name)));
        const captions = files.filter((file) => isCaptionFile(file.name));
        const unsupported = files.filter((file) => !VIDEO_EXTENSIONS.has(extension(file.name)) && !isCaptionFile(file.name));
        const videoStems = new Map<string, number>();
        const captionStems = new Map<string, number>();
        videos.forEach((file) => videoStems.set(stem(file.name), (videoStems.get(stem(file.name)) || 0) + 1));
        captions.forEach((file) => captionStems.set(stem(file.name), (captionStems.get(stem(file.name)) || 0) + 1));
        const missingCaptions = [...videoStems.keys()].filter((key) => !captionStems.has(key));
        const orphanCaptions = [...captionStems.keys()].filter((key) => !videoStems.has(key));
        const duplicates = [...videoStems, ...captionStems].filter(([, count]) => count > 1).map(([key]) => key);
        const totalBytes = files.reduce((total, file) => total + file.size, 0);
        let validationError = '';
        if (unsupported.length) validationError = t('web_resources.upload_unsupported');
        else if (!videos.length) validationError = t('web_resources.upload_need_pair');
        else if (missingCaptions.length || orphanCaptions.length || duplicates.length) validationError = t('web_resources.upload_pair_error');
        else if (roots && totalBytes > roots.uploadLimits.maxSessionBytes) validationError = t('web_resources.upload_too_large');
        else if (roots && files.some((file) => file.size > (isCaptionFile(file.name) ? roots.uploadLimits.maxCaptionBytes : roots.uploadLimits.maxFileBytes))) validationError = t('web_resources.upload_file_too_large');
        return { videos, captions, totalBytes, validationError };
    }, [files, roots, t]);

    const handleUpload = async () => {
        if (selection.validationError || !files.length) return;
        setBusy(true);
        onBusyChange?.(true);
        setError('');
        setCompletedPath('');
        setSentBytes(0);
        let sessionId = '';
        try {
            const session = await webFiles.createUploadSession();
            sessionId = session.sessionId;
            let completedBytes = 0;
            for (const file of files) {
                await webFiles.upload(session.sessionId, file, (currentFileBytes) => {
                    setSentBytes(completedBytes + currentFileBytes);
                });
                completedBytes += file.size;
                setSentBytes(completedBytes);
            }
            const result = await webFiles.finalizeUpload(session.sessionId);
            setCompletedPath(result.path);
            onUploaded(result.path);
        } catch (reason) {
            if (sessionId) {
                try {
                    await webFiles.cancelUpload(sessionId);
                } catch {
                    // A finalized dataset is intentionally not removable here.
                }
            }
            setError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            setBusy(false);
            onBusyChange?.(false);
        }
    };

    const percent = selection.totalBytes > 0
        ? Math.min(100, Math.round((sentBytes / selection.totalBytes) * 100))
        : 0;

    return (
        <div
            className={`col-span-2 rounded-xl border border-dashed border-primary/30 bg-primary/5 p-4 space-y-3 ${disabled ? 'opacity-60' : ''}`}
            aria-disabled={disabled}
        >
            <div className="flex items-start justify-between gap-4">
                <div>
                    <div className="font-semibold flex items-center gap-2">
                        <UploadCloud className="w-4 h-4" />
                        {t(isValidation ? 'web_resources.upload_validation_dataset' : 'web_resources.upload_dataset')}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                        {t(isValidation ? 'web_resources.upload_validation_dataset_hint' : 'web_resources.upload_dataset_hint')}
                    </div>
                    {roots && <div className="text-[11px] text-muted-foreground mt-1">{t('web_resources.upload_destination')}: {roots.uploadRoot}</div>}
                </div>
                <label className={`rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm whitespace-nowrap ${disabled ? 'cursor-not-allowed' : 'cursor-pointer hover:bg-white/10'}`}>
                    {t('web_resources.choose_files')}
                    <input
                        type="file"
                        accept=".mp4,.mov,.mkv,.webm,.avi,.txt"
                        multiple
                        className="hidden"
                        disabled={busy || disabled}
                        onChange={(event) => {
                            setFiles(Array.from(event.target.files || []));
                            setError('');
                            setCompletedPath('');
                            setSentBytes(0);
                        }}
                    />
                </label>
            </div>

            {disabled && isValidation && (
                <div className="text-xs text-muted-foreground">{t('web_resources.upload_validation_disabled')}</div>
            )}

            {files.length > 0 && (
                <div className="rounded-lg bg-black/15 p-3 text-sm">
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                        <span className="flex items-center gap-1"><Video className="w-3.5 h-3.5" />{selection.videos.length} {t('web_resources.videos')}</span>
                        <span>{selection.captions.length} {t('web_resources.captions')}</span>
                        <span>{formatBytes(selection.totalBytes)}</span>
                    </div>
                    {selection.validationError && <div className="text-red-400 text-xs mt-2">{selection.validationError}</div>}
                </div>
            )}

            {busy && (
                <div className="space-y-1">
                    <div className="h-2 rounded-full bg-white/10 overflow-hidden"><div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} /></div>
                    <div className="text-xs text-muted-foreground">{t('web_resources.uploading')} {percent}% · {formatBytes(sentBytes)} / {formatBytes(selection.totalBytes)}</div>
                </div>
            )}
            {completedPath && <div className="flex items-center gap-2 text-sm text-emerald-400 break-all"><CheckCircle2 className="w-4 h-4 flex-shrink-0" />{t(isValidation ? 'web_resources.upload_validation_complete' : 'web_resources.upload_complete')}: {completedPath}</div>}
            {error && <div className="text-sm text-red-400">{error}</div>}

            <div className="flex justify-end">
                <GlassButton type="button" onClick={() => void handleUpload()} disabled={disabled || busy || !files.length || !!selection.validationError}>
                    {busy ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <UploadCloud className="w-4 h-4 mr-2" />}
                    {t(isValidation ? 'web_resources.upload_and_use_validation_dataset' : 'web_resources.upload_and_use')}
                </GlassButton>
            </div>
        </div>
    );
}
