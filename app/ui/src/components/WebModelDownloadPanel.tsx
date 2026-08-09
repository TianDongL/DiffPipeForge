import { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, CloudDownload, FolderSearch, Loader2, RefreshCw, Search } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { formatBytes, ModelDownloadFile, ModelDownloadJob, webFiles, WebRootsResponse } from '@/lib/webFiles';
import { GlassButton } from './ui/GlassButton';
import { WebPathPicker } from './ui/WebPathPicker';

interface WebModelDownloadPanelProps {
    modelType: string;
    onPathsReady: (paths: Record<string, string>) => void;
}

function joinServerPath(base: string, name: string): string {
    return `${base.replace(/[\\/]+$/, '')}/${name}`;
}

export function WebModelDownloadPanel({ modelType, onPathsReady }: WebModelDownloadPanelProps) {
    const { t, i18n } = useTranslation();
    const [expanded, setExpanded] = useState(false);
    const [roots, setRoots] = useState<WebRootsResponse | null>(null);
    const [source, setSource] = useState<'huggingface' | 'modelscope'>(i18n.language.startsWith('zh') ? 'modelscope' : 'huggingface');
    const [repoId, setRepoId] = useState('');
    const [revision, setRevision] = useState('');
    const [targetDir, setTargetDir] = useState('');
    const [fileText, setFileText] = useState('');
    const [presetFiles, setPresetFiles] = useState<ModelDownloadFile[]>([]);
    const [job, setJob] = useState<ModelDownloadJob | null>(null);
    const [jobModelType, setJobModelType] = useState('');
    const [busy, setBusy] = useState(false);
    const [discovering, setDiscovering] = useState(false);
    const [error, setError] = useState('');
    const [pickerOpen, setPickerOpen] = useState(false);
    const onPathsReadyRef = useRef(onPathsReady);
    const modelTypeRef = useRef(modelType);

    useEffect(() => {
        onPathsReadyRef.current = onPathsReady;
    }, [onPathsReady]);

    useEffect(() => {
        modelTypeRef.current = modelType;
    }, [modelType]);

    useEffect(() => {
        void webFiles.roots().then((result) => {
            setRoots(result);
            setTargetDir((current) => current || result.recommendedModelBase.path);
        }).catch((reason) => setError(reason instanceof Error ? reason.message : String(reason)));
    }, []);

    const activeJobId = job && ['queued', 'running'].includes(job.status) ? job.id : null;
    useEffect(() => {
        if (!activeJobId) return;
        let cancelled = false;
        let timer: number | undefined;

        const poll = async () => {
            try {
                const nextJob = await webFiles.modelDownloadStatus(activeJobId);
                if (cancelled) return;
                setJob(nextJob);
                setError('');
                if (
                    nextJob.status === 'completed'
                    && Object.keys(nextJob.pathMap).length > 0
                    && jobModelType === modelTypeRef.current
                ) {
                    onPathsReadyRef.current(nextJob.pathMap);
                    return;
                }
                if (['queued', 'running'].includes(nextJob.status)) {
                    timer = window.setTimeout(() => void poll(), 1000);
                }
            } catch (reason) {
                if (cancelled) return;
                setError(reason instanceof Error ? reason.message : String(reason));
                // A transient proxy/network error must not strand a live job.
                timer = window.setTimeout(() => void poll(), 3000);
            }
        };

        timer = window.setTimeout(() => void poll(), 1000);
        return () => {
            cancelled = true;
            if (timer !== undefined) window.clearTimeout(timer);
        };
    }, [activeJobId, jobModelType]);

    const parsedFiles = useMemo(() => {
        const isMiniMaxPreset = roots && repoId === roots.presets.minimaxH3.repoId;
        const metadata = new Map((isMiniMaxPreset ? presetFiles : []).map((file) => [file.path, file]));
        return fileText
            .split(/\r?\n/)
            .map((line) => line.trim())
            .filter(Boolean)
            .map((line) => {
                const preset = metadata.get(line);
                if (preset) return preset;
                const [path, sizeText = '', sha256 = '', field = ''] = line.split('|').map((part) => part.trim());
                const file: ModelDownloadFile = { path };
                if (/^[1-9][0-9]*$/.test(sizeText)) file.size = Number(sizeText);
                if (/^[a-fA-F0-9]{64}$/.test(sha256)) file.sha256 = sha256.toLowerCase();
                if (field) file.field = field;
                return file;
            });
    }, [fileText, presetFiles, repoId, roots]);

    const applyMiniMaxPreset = () => {
        if (!roots) return;
        const preset = roots.presets.minimaxH3;
        const nextSource = source;
        setRepoId(preset.repoId);
        setRevision(nextSource === 'huggingface' ? preset.huggingfaceRevision : preset.modelscopeRevision);
        setPresetFiles(preset.files);
        setFileText(preset.files.map((file) => file.path).join('\n'));
        setTargetDir(joinServerPath(roots.recommendedModelBase.path, 'MiniMax-H3'));
        setExpanded(true);
        setError('');
    };

    useEffect(() => {
        if (!roots || repoId !== roots.presets.minimaxH3.repoId) return;
        setRevision(source === 'huggingface'
            ? roots.presets.minimaxH3.huggingfaceRevision
            : roots.presets.minimaxH3.modelscopeRevision);
    }, [repoId, roots, source]);

    const discoverMiniMax = async () => {
        const requestedModelType = modelType;
        setDiscovering(true);
        setError('');
        try {
            const result = await webFiles.discoverMiniMaxH3();
            if (!result.complete) {
                throw new Error(t('web_resources.minimax_not_complete'));
            }
            if (requestedModelType === modelTypeRef.current) {
                onPathsReadyRef.current(result.pathMap);
            }
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            setDiscovering(false);
        }
    };

    const startDownload = async () => {
        if (!repoId.trim() || !revision.trim() || !targetDir.trim() || parsedFiles.length === 0) {
            setError(t('web_resources.download_required'));
            return;
        }
        if (parsedFiles.some((file) => !file.size)) {
            setError(t('web_resources.download_metadata_required'));
            return;
        }
        setBusy(true);
        setError('');
        try {
            const nextJob = await webFiles.startModelDownload({
                source,
                repoId: repoId.trim(),
                revision: revision.trim(),
                targetDir: targetDir.trim(),
                files: parsedFiles,
            });
            setJobModelType(modelType);
            setJob(nextJob);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : String(reason));
        } finally {
            setBusy(false);
        }
    };

    const progress = job?.totalBytes
        ? Math.min(100, Math.round((job.bytesDownloaded / job.totalBytes) * 100))
        : job?.totalFiles
            ? Math.round((job.completedFiles / job.totalFiles) * 100)
            : 0;
    const running = job && ['queued', 'running'].includes(job.status);

    return (
        <div className="col-span-2 rounded-xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div className="font-semibold flex items-center gap-2"><CloudDownload className="w-4 h-4" />{t('web_resources.model_manager')}</div>
                    <div className="text-xs text-muted-foreground mt-1">{t('web_resources.model_manager_hint')}</div>
                </div>
                <div className="flex flex-wrap gap-2">
                    {modelType === 'minimax_h3' && (
                        <>
                            <GlassButton type="button" variant="outline" size="sm" onClick={() => void discoverMiniMax()} disabled={discovering || !!running}>
                                {discovering ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Search className="w-4 h-4 mr-2" />}
                                {t('web_resources.detect_minimax')}
                            </GlassButton>
                            <GlassButton type="button" variant="outline" size="sm" onClick={applyMiniMaxPreset} disabled={!roots || !!running}>
                                <CloudDownload className="w-4 h-4 mr-2" />{t('web_resources.prepare_minimax')}
                            </GlassButton>
                        </>
                    )}
                    <GlassButton type="button" variant="ghost" size="sm" onClick={() => setExpanded((value) => !value)}>
                        {expanded ? t('web_resources.collapse') : t('web_resources.generic_download')}
                    </GlassButton>
                </div>
            </div>

            {roots && (
                <div className="flex flex-wrap gap-2 text-[11px]">
                    {roots.roots.map((root) => (
                        <span key={root.id} className="rounded-full bg-white/5 border border-white/10 px-2 py-1" title={`${root.path} · ${root.source} · ${root.filesystem}`}>
                            {root.path} · {t(`web_resources.storage_${root.storageKind}`)}{root.writable ? '' : ` · ${t('web_resources.read_only')}`}
                        </span>
                    ))}
                </div>
            )}

            {expanded && (
                <div className="grid md:grid-cols-2 gap-3 pt-2 border-t border-white/10">
                    <label className="space-y-1 text-sm">
                        <span className="text-muted-foreground">{t('web_resources.download_source')}</span>
                        <select value={source} onChange={(event) => setSource(event.target.value as 'huggingface' | 'modelscope')} disabled={!!running} className="w-full rounded-lg bg-black/20 border border-white/10 px-3 py-2">
                            <option value="modelscope">ModelScope</option>
                            <option value="huggingface">Hugging Face</option>
                        </select>
                    </label>
                    <label className="space-y-1 text-sm">
                        <span className="text-muted-foreground">{t('web_resources.repo_id')}</span>
                        <input value={repoId} onChange={(event) => setRepoId(event.target.value)} disabled={!!running} placeholder="owner/repository" className="w-full rounded-lg bg-black/20 border border-white/10 px-3 py-2" />
                    </label>
                    <label className="space-y-1 text-sm">
                        <span className="text-muted-foreground">{t('web_resources.revision')}</span>
                        <input value={revision} onChange={(event) => setRevision(event.target.value)} disabled={!!running} placeholder={source === 'modelscope' ? 'master' : 'main or commit'} className="w-full rounded-lg bg-black/20 border border-white/10 px-3 py-2 font-mono" />
                    </label>
                    <label className="space-y-1 text-sm">
                        <span className="text-muted-foreground">{t('web_resources.download_target')}</span>
                        <div className="flex gap-2">
                            <input value={targetDir} onChange={(event) => setTargetDir(event.target.value)} disabled={!!running} className="min-w-0 flex-1 rounded-lg bg-black/20 border border-white/10 px-3 py-2 font-mono" />
                            <GlassButton type="button" variant="outline" size="icon" onClick={() => setPickerOpen(true)} disabled={!!running}><FolderSearch className="w-4 h-4" /></GlassButton>
                        </div>
                    </label>
                    <label className="md:col-span-2 space-y-1 text-sm">
                        <span className="text-muted-foreground">{t('web_resources.file_manifest')}</span>
                        <textarea value={fileText} onChange={(event) => setFileText(event.target.value)} disabled={!!running} rows={5} placeholder={t('web_resources.file_manifest_hint')} className="w-full rounded-lg bg-black/20 border border-white/10 px-3 py-2 font-mono text-xs resize-y" />
                        <span className="block text-[11px] text-muted-foreground">{t('web_resources.file_manifest_format')}</span>
                    </label>
                    <div className="md:col-span-2 flex flex-wrap items-center justify-between gap-3">
                        <div className="text-xs text-muted-foreground">{t('web_resources.token_hint')}</div>
                        <GlassButton type="button" onClick={() => void startDownload()} disabled={busy || !!running}>
                            {busy || running ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : job?.status === 'error' ? <RefreshCw className="w-4 h-4 mr-2" /> : <CloudDownload className="w-4 h-4 mr-2" />}
                            {job?.status === 'error' ? t('web_resources.resume_download') : t('web_resources.start_download')}
                        </GlassButton>
                    </div>
                </div>
            )}

            {job && (
                <div className="rounded-lg bg-black/15 p-3 space-y-2">
                    <div className="flex justify-between text-xs gap-3">
                        <span className="truncate">{job.currentFile || t(`web_resources.download_${job.status}`)}</span>
                        <span className="whitespace-nowrap">{job.completedFiles}/{job.totalFiles} · {formatBytes(job.bytesDownloaded)}{job.totalBytes ? ` / ${formatBytes(job.totalBytes)}` : ''}</span>
                    </div>
                    <div className="h-2 rounded-full bg-white/10 overflow-hidden"><div className={`h-full transition-all ${job.status === 'error' ? 'bg-red-500' : 'bg-primary'}`} style={{ width: `${progress}%` }} /></div>
                    {job.status === 'completed' && <div className="text-sm text-emerald-400 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />{t('web_resources.download_completed')}</div>}
                    {job.error && <div className="text-sm text-red-400">{job.error}</div>}
                </div>
            )}
            {error && <div className="text-sm text-red-400">{error}</div>}

            <WebPathPicker
                open={pickerOpen}
                title={t('web_resources.select_model_target')}
                mode="directory"
                allowCreate
                writableOnly
                initialPath={targetDir}
                onClose={() => setPickerOpen(false)}
                onSelect={setTargetDir}
            />
        </div>
    );
}
