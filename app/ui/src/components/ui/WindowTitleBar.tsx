import { Minus, Square, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export function WindowTitleBar() {
    const { t } = useTranslation();

    const handleMinimize = () => {
        // @ts-ignore
        window.ipcRenderer.send('window-minimize');
    };

    const handleMaximize = () => {
        // @ts-ignore
        window.ipcRenderer.send('window-toggle-maximize');
    };

    const handleClose = () => {
        // @ts-ignore
        window.ipcRenderer.send('window-close');
    };

    return (
        <div className="h-10 w-full flex items-center justify-between bg-white/40 dark:bg-black/40 backdrop-blur-xl border-b border-white/20 dark:border-white/10 select-none z-[9999]" style={{ WebkitAppRegion: 'drag' } as any}>
            <div className="flex items-center gap-2 px-4 pointer-events-none">
                <img src="icon.png" alt="App Icon" className="w-5 h-5" />
                <span className="text-xs font-bold tracking-tight text-foreground/80">
                    {t('app.title') || 'DiffPipe Forge'}
                    <span className="mx-2 opacity-30">|</span>
                    <span className="font-medium opacity-60 text-[10px] uppercase tracking-widest">天冬制作</span>
                </span>
            </div>

            {window.ipcRenderer && (
                <div className="flex items-center h-full" style={{ WebkitAppRegion: 'no-drag' } as any}>
                    <button
                        onClick={handleMinimize}
                        className="h-full px-4 hover:bg-black/5 dark:hover:bg-white/5 transition-colors group"
                        title={t('window.minimize') || 'Minimize'}
                    >
                        <Minus className="w-3.5 h-3.5 text-foreground/60 group-hover:text-foreground" />
                    </button>
                    <button
                        onClick={handleMaximize}
                        className="h-full px-4 hover:bg-black/5 dark:hover:bg-white/5 transition-colors group"
                        title={t('window.maximize') || 'Maximize'}
                    >
                        <Square className="w-3 h-3 text-foreground/60 group-hover:text-foreground" />
                    </button>
                    <button
                        onClick={handleClose}
                        className="h-full px-4 hover:bg-red-500/80 transition-colors group"
                        title={t('window.close') || 'Close'}
                    >
                        <X className="w-4 h-4 text-foreground/60 group-hover:text-white" />
                    </button>
                </div>
            )}

        </div>
    );
}
