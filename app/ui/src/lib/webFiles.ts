export type StorageKind = 'persistent' | 'temporary' | 'public_models' | 'local';

export interface WebResourceRoot {
    id: string;
    path: string;
    name: string;
    role: string;
    storageKind: StorageKind;
    writable: boolean;
    source: string;
    filesystem: string;
}

export interface WebResourceEntry {
    name: string;
    path: string;
    type: 'directory' | 'file';
    size: number;
    modified: number;
    extension: string;
    modelCandidate: boolean;
}

export interface ModelDownloadFile {
    path: string;
    size?: number;
    sha256?: string;
    field?: string;
}

export interface ModelDownloadJob {
    id: string;
    source: 'huggingface' | 'modelscope';
    repoId: string;
    revision: string;
    targetDir: string;
    status: 'queued' | 'running' | 'completed' | 'error' | 'interrupted';
    totalFiles: number;
    completedFiles: number;
    currentFile: string | null;
    bytesDownloaded: number;
    totalBytes: number | null;
    pathMap: Record<string, string>;
    error: string | null;
    resumable: boolean;
}

export interface WebRootsResponse {
    roots: WebResourceRoot[];
    uploadRoot: string;
    recommendedOutputBase: {
        path: string;
        exists: boolean;
        writable: boolean;
        storageKind: StorageKind;
    };
    recommendedModelBase: {
        path: string;
        exists: boolean;
        writable: boolean;
        storageKind: StorageKind;
    };
    modelExtensions: string[];
    uploadLimits: {
        maxFileBytes: number;
        maxSessionBytes: number;
        maxCaptionBytes: number;
    };
    presets: {
        minimaxH3: {
            repoId: string;
            huggingfaceRevision: string;
            modelscopeRevision: string;
            files: ModelDownloadFile[];
        };
    };
}

async function webRequest<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(path, init);
    let payload: any = null;
    try {
        payload = await response.json();
    } catch {
        // A non-JSON reverse-proxy error is still surfaced with its HTTP code.
    }
    if (!response.ok) {
        const detail = payload?.detail;
        const message = typeof detail === 'string'
            ? detail
            : detail?.message || payload?.error || `HTTP ${response.status}`;
        throw new Error(message);
    }
    return payload as T;
}

function jsonInit(payload: unknown): RequestInit {
    return {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
    };
}

export const webFiles = {
    roots: () => webRequest<WebRootsResponse>('/api/web-resources/roots'),

    list: (path: string, modelOnly = false) => webRequest<{
        path: string;
        root: string;
        parent: string | null;
        entries: WebResourceEntry[];
        truncated: boolean;
    }>('/api/web-resources/list', jsonInit({ path, modelOnly })),

    search: (path: string, query: string, mode: 'model' | 'file' | 'directory') => webRequest<{
        path: string;
        root: string;
        entries: WebResourceEntry[];
        scanned: number;
        truncated: boolean;
    }>('/api/web-resources/search', jsonInit({ path, query, mode })),

    mkdir: (parent: string, name: string) => webRequest<{ path: string }>(
        '/api/web-resources/mkdir',
        jsonInit({ parent, name }),
    ),

    ensureDirectory: (path: string) => webRequest<{ path: string }>(
        '/api/web-resources/ensure-directory',
        jsonInit({ path }),
    ),

    createUploadSession: () => webRequest<{ sessionId: string; path: string }>(
        '/api/web-resources/upload-session',
        { method: 'POST' },
    ),

    upload: async (
        sessionId: string,
        file: File,
        onProgress: (sentBytes: number) => void,
    ): Promise<{ name: string; size: number; path: string }> => {
        const url = `/api/web-resources/upload/${encodeURIComponent(sessionId)}?filename=${encodeURIComponent(file.name)}`;
        return new Promise((resolve, reject) => {
            const request = new XMLHttpRequest();
            request.open('PUT', url);
            request.responseType = 'json';
            request.upload.onprogress = (event) => onProgress(event.loaded);
            request.onerror = () => reject(new Error('Network error while uploading the dataset'));
            request.onload = () => {
                const payload = request.response;
                if (request.status < 200 || request.status >= 300) {
                    const detail = payload?.detail;
                    reject(new Error(typeof detail === 'string' ? detail : detail?.message || `HTTP ${request.status}`));
                    return;
                }
                resolve(payload);
            };
            request.send(file);
        });
    },

    finalizeUpload: (sessionId: string) => webRequest<{
        path: string;
        videoCount: number;
        captionCount: number;
        totalBytes: number;
    }>(`/api/web-resources/upload/${encodeURIComponent(sessionId)}/finalize`, { method: 'POST' }),

    cancelUpload: (sessionId: string) => webRequest<{ success: boolean }>(
        `/api/web-resources/upload/${encodeURIComponent(sessionId)}`,
        { method: 'DELETE' },
    ),

    discoverMiniMaxH3: () => webRequest<{
        complete: boolean;
        pathMap: Record<string, string>;
        candidates: Record<string, string[]>;
        verifiedBy: string;
        scanned: number;
        truncated: boolean;
    }>('/api/web-resources/presets/minimax-h3/discover'),

    startModelDownload: (payload: {
        source: 'huggingface' | 'modelscope';
        repoId: string;
        revision: string;
        targetDir: string;
        files: ModelDownloadFile[];
    }) => webRequest<ModelDownloadJob>('/api/web-resources/model-downloads', jsonInit(payload)),

    modelDownloadStatus: (jobId: string) => webRequest<ModelDownloadJob>(
        `/api/web-resources/model-downloads/${encodeURIComponent(jobId)}`,
    ),
};

export function formatBytes(value: number): string {
    if (!Number.isFinite(value) || value <= 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const exponent = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    return `${(value / 1024 ** exponent).toFixed(exponent === 0 ? 0 : 1)} ${units[exponent]}`;
}
