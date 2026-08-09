import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Database, File, Folder, FolderPlus, HardDrive, Loader2, Search, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { webFiles, WebResourceEntry, WebResourceRoot } from '@/lib/webFiles';
import { GlassButton } from './GlassButton';
import { GlassCard } from './GlassCard';

interface WebPathPickerProps {
    open: boolean;
    title: string;
    mode: 'file' | 'directory';
    modelOnly?: boolean;
    allowCreate?: boolean;
    writableOnly?: boolean;
    initialPath?: string;
    onClose: () => void;
    onSelect: (path: string) => void;
}

function storageIcon(kind: WebResourceRoot['storageKind']) {
    if (kind === 'persistent') return <Database className="w-4 h-4" />;
    return <HardDrive className="w-4 h-4" />;
}

function normalizedServerPath(path: string): string {
    return path.replace(/\\/g, '/').replace(/\/+$/, '');
}

function pathWithinServerRoot(path: string, root: string): boolean {
    let candidate = normalizedServerPath(path);
    let base = normalizedServerPath(root);
    if (/^[A-Za-z]:\//.test(base)) {
        candidate = candidate.toLocaleLowerCase();
        base = base.toLocaleLowerCase();
    }
    return candidate === base || candidate.startsWith(`${base}/`);
}

function serverParentPath(path: string): string {
    const normalized = normalizedServerPath(path);
    const separator = normalized.lastIndexOf('/');
    if (separator <= 0) return normalized;
    if (separator === 2 && /^[A-Za-z]:/.test(normalized)) return normalized.slice(0, 3);
    return normalized.slice(0, separator);
}

export function WebPathPicker({
    open,
    title,
    mode,
    modelOnly = false,
    allowCreate = false,
    writableOnly = false,
    initialPath,
    onClose,
    onSelect,
}: WebPathPickerProps) {
    const { t } = useTranslation();
    const [roots, setRoots] = useState<WebResourceRoot[]>([]);
    const [currentPath, setCurrentPath] = useState('');
    const [parentPath, setParentPath] = useState<string | null>(null);
    const [entries, setEntries] = useState<WebResourceEntry[]>([]);
    const [selected, setSelected] = useState<WebResourceEntry | null>(null);
    const [query, setQuery] = useState('');
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');
    const [truncated, setTruncated] = useState(false);
    const [creating, setCreating] = useState(false);
    const [newFolderName, setNewFolderName] = useState('');
    const requestIdRef = useRef(0);

    const loadDirectory = useCallback(async (path: string) => {
        const requestId = ++requestIdRef.current;
        setLoading(true);
        setError('');
        setSelected(null);
        try {
            const result = await webFiles.list(path, modelOnly);
            if (requestId !== requestIdRef.current) return false;
            setCurrentPath(result.path);
            setParentPath(result.parent);
            setEntries(result.entries);
            setTruncated(result.truncated);
            setQuery('');
            return true;
        } catch (reason) {
            if (requestId === requestIdRef.current) {
                setError(reason instanceof Error ? reason.message : String(reason));
            }
            return false;
        } finally {
            if (requestId === requestIdRef.current) setLoading(false);
        }
    }, [modelOnly]);

    useEffect(() => {
        if (!open) return;
        let cancelled = false;
        setLoading(true);
        setError('');
        void webFiles.roots().then((result) => {
            if (cancelled) return;
            const availableRoots = writableOnly
                ? result.roots.filter((root) => root.writable)
                : result.roots;
            setRoots(availableRoots);
            const matchingRoot = initialPath
                ? availableRoots
                    .filter((root) => pathWithinServerRoot(initialPath, root.path))
                    .sort((a, b) => b.path.length - a.path.length)[0]
                : undefined;
            const modelRoot = modelOnly
                ? availableRoots.find((root) => root.storageKind === 'public_models')
                    || availableRoots.find((root) => root.role === 'usrdata' || root.role === 'cloud')
                : undefined;
            const fallback = matchingRoot?.path || modelRoot?.path || availableRoots[0]?.path;
            if (!fallback) throw new Error(t('web_resources.no_roots'));
            const desired = matchingRoot && initialPath
                ? (mode === 'file' ? serverParentPath(initialPath) : normalizedServerPath(initialPath))
                : fallback;
            return loadDirectory(desired).then((loaded) => {
                if (!loaded && !cancelled && desired !== fallback) return loadDirectory(fallback);
                return loaded;
            });
        }).catch((reason) => {
            if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason));
        }).finally(() => {
            if (!cancelled) setLoading(false);
        });
        return () => {
            cancelled = true;
            requestIdRef.current += 1;
        };
    }, [initialPath, loadDirectory, mode, modelOnly, open, t, writableOnly]);

    const currentRoot = useMemo(() => roots
        .filter((root) => pathWithinServerRoot(currentPath, root.path))
        .sort((a, b) => b.path.length - a.path.length)[0], [currentPath, roots]);

    const handleSearch = async (event: React.FormEvent) => {
        event.preventDefault();
        if (query.trim().length < 2) {
            setError(t('web_resources.search_min'));
            return;
        }
        const requestId = ++requestIdRef.current;
        setLoading(true);
        setError('');
        setSelected(null);
        try {
            const result = await webFiles.search(currentPath, query.trim(), modelOnly ? 'model' : mode);
            if (requestId !== requestIdRef.current) return;
            setEntries(result.entries);
            setTruncated(result.truncated);
        } catch (reason) {
            if (requestId === requestIdRef.current) {
                setError(reason instanceof Error ? reason.message : String(reason));
            }
        } finally {
            if (requestId === requestIdRef.current) setLoading(false);
        }
    };

    const handleCreate = async () => {
        if (!newFolderName.trim()) return;
        const requestId = ++requestIdRef.current;
        setLoading(true);
        setError('');
        try {
            const result = await webFiles.mkdir(currentPath, newFolderName.trim());
            if (requestId !== requestIdRef.current) return;
            setCreating(false);
            setNewFolderName('');
            await loadDirectory(result.path);
        } catch (reason) {
            if (requestId === requestIdRef.current) {
                setError(reason instanceof Error ? reason.message : String(reason));
                setLoading(false);
            }
        }
    };

    const handleEntryOpen = (entry: WebResourceEntry) => {
        if (entry.type === 'directory') {
            void loadDirectory(entry.path);
        } else if (mode === 'file') {
            onSelect(entry.path);
            onClose();
        }
    };

    const choosePath = () => {
        const path = mode === 'directory' && selected?.type === 'directory' ? selected.path : currentPath;
        if (mode === 'file') {
            if (selected?.type !== 'file') return;
            onSelect(selected.path);
        } else {
            onSelect(path);
        }
        onClose();
    };

    if (!open) return null;

    return (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
            <GlassCard className="w-full max-w-6xl h-[78vh] min-h-[520px] flex flex-col overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-white/10">
                    <div>
                        <h3 className="text-xl font-bold">{title}</h3>
                        <p className="text-xs text-muted-foreground mt-1">{t('web_resources.sandbox_hint')}</p>
                    </div>
                    <button type="button" onClick={onClose} className="p-2 rounded-lg hover:bg-white/10" aria-label={t('common.cancel')}>
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="flex flex-1 min-h-0">
                    <aside className="w-64 border-r border-white/10 p-3 overflow-y-auto space-y-2">
                        <div className="text-xs font-semibold text-muted-foreground px-2 pb-1">{t('web_resources.platform_roots')}</div>
                        {roots.map((root) => (
                            <button
                                key={root.id}
                                type="button"
                                onClick={() => void loadDirectory(root.path)}
                                className={`w-full text-left rounded-xl p-3 border transition-colors ${currentRoot?.id === root.id ? 'bg-primary/15 border-primary/30' : 'bg-white/5 border-white/5 hover:bg-white/10'}`}
                            >
                                <div className="flex items-center gap-2 font-medium text-sm">
                                    {storageIcon(root.storageKind)}
                                    <span className="truncate">{root.name}</span>
                                </div>
                                <div className="text-[11px] text-muted-foreground mt-1 break-all">{root.path}</div>
                                <div className="flex flex-wrap gap-1 mt-2">
                                    <span className="px-1.5 py-0.5 rounded bg-white/10 text-[10px]">{t(`web_resources.storage_${root.storageKind}`)}</span>
                                    {!root.writable && <span className="px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-400 text-[10px]">{t('web_resources.read_only')}</span>}
                                </div>
                                <div className="text-[10px] text-muted-foreground mt-1 truncate" title={`${root.source} (${root.filesystem})`}>
                                    {root.source} · {root.filesystem}
                                </div>
                            </button>
                        ))}
                    </aside>

                    <section className="flex-1 flex flex-col min-w-0">
                        <div className="p-3 border-b border-white/10 space-y-3">
                            <div className="flex items-center gap-2">
                                <GlassButton type="button" variant="outline" size="icon" disabled={!parentPath || loading} onClick={() => parentPath && void loadDirectory(parentPath)}>
                                    <ArrowLeft className="w-4 h-4" />
                                </GlassButton>
                                <div className="flex-1 rounded-lg bg-black/20 border border-white/10 px-3 py-2 text-sm font-mono truncate" title={currentPath}>
                                    {currentPath}
                                </div>
                                {allowCreate && currentRoot?.writable && (
                                    <GlassButton type="button" variant="outline" onClick={() => setCreating((value) => !value)}>
                                        <FolderPlus className="w-4 h-4 mr-2" />
                                        {t('web_resources.new_folder')}
                                    </GlassButton>
                                )}
                            </div>
                            {creating && (
                                <div className="flex items-center gap-2">
                                    <input
                                        value={newFolderName}
                                        onChange={(event) => setNewFolderName(event.target.value)}
                                        onKeyDown={(event) => { if (event.key === 'Enter') void handleCreate(); }}
                                        placeholder={t('web_resources.folder_name')}
                                        className="flex-1 rounded-lg bg-black/20 border border-white/10 px-3 py-2 text-sm outline-none focus:border-primary/50"
                                        autoFocus
                                    />
                                    <GlassButton type="button" onClick={() => void handleCreate()} disabled={loading || !newFolderName.trim()}>{t('common.confirm')}</GlassButton>
                                </div>
                            )}
                            <form onSubmit={handleSearch} className="flex items-center gap-2">
                                <div className="relative flex-1">
                                    <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                                    <input
                                        value={query}
                                        onChange={(event) => setQuery(event.target.value)}
                                        placeholder={modelOnly ? t('web_resources.search_models') : t('web_resources.search_files')}
                                        className="w-full rounded-lg bg-black/20 border border-white/10 pl-9 pr-3 py-2 text-sm outline-none focus:border-primary/50"
                                    />
                                </div>
                                <GlassButton type="submit" variant="outline" disabled={loading || query.trim().length < 2}>{t('common.search')}</GlassButton>
                                {query && <GlassButton type="button" variant="ghost" onClick={() => void loadDirectory(currentPath)}>{t('web_resources.clear_search')}</GlassButton>}
                            </form>
                        </div>

                        <div className="flex-1 overflow-y-auto p-3">
                            {loading ? (
                                <div className="h-full flex items-center justify-center text-muted-foreground"><Loader2 className="w-6 h-6 animate-spin mr-2" />{t('common.loading')}</div>
                            ) : entries.length === 0 ? (
                                <div className="h-full flex items-center justify-center text-muted-foreground">{t('web_resources.empty')}</div>
                            ) : (
                                <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
                                    {entries.map((entry) => (
                                        <button
                                            key={entry.path}
                                            type="button"
                                            onClick={() => setSelected(entry)}
                                            onDoubleClick={() => handleEntryOpen(entry)}
                                            className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-colors ${selected?.path === entry.path ? 'bg-primary/15 border-primary/40' : 'bg-white/5 border-white/5 hover:bg-white/10'}`}
                                        >
                                            {entry.type === 'directory' ? <Folder className="w-5 h-5 text-amber-400 flex-shrink-0" /> : <File className="w-5 h-5 text-blue-400 flex-shrink-0" />}
                                            <div className="min-w-0 flex-1">
                                                <div className="truncate text-sm font-medium">{entry.name}</div>
                                                <div className="truncate text-[11px] text-muted-foreground">{entry.path}</div>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            )}
                            {truncated && <div className="text-xs text-amber-400 mt-3">{t('web_resources.results_truncated')}</div>}
                        </div>
                    </section>
                </div>

                {error && <div className="mx-5 mb-2 rounded-lg bg-red-500/10 border border-red-500/20 px-3 py-2 text-sm text-red-400">{error}</div>}
                <div className="flex items-center justify-between gap-3 px-5 py-4 border-t border-white/10">
                    <div className="text-xs text-muted-foreground truncate">{selected?.path || (mode === 'directory' ? currentPath : t('web_resources.select_file_hint'))}</div>
                    <div className="flex gap-2 flex-shrink-0">
                        <GlassButton type="button" variant="ghost" onClick={onClose}>{t('common.cancel')}</GlassButton>
                        <GlassButton
                            type="button"
                            onClick={choosePath}
                            disabled={loading || (mode === 'file' && selected?.type !== 'file')}
                        >
                            {t('web_resources.use_path')}
                        </GlassButton>
                    </div>
                </div>
            </GlassCard>
        </div>
    );
}
