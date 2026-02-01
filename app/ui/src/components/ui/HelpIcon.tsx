import { useState, useRef, useEffect } from 'react';
import { HelpCircle, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

interface HelpIconProps {
    text: string;
    className?: string;
}

export function HelpIcon({ text, className }: HelpIconProps) {
    const { t } = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const popupRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (popupRef.current && !popupRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        } else {
            document.removeEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    return (
        <div className={cn("relative inline-flex items-center", className)}>
            <button
                type="button"
                onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setIsOpen(!isOpen);
                }}
                className="text-muted-foreground hover:text-primary transition-colors focus:outline-none"
            >
                <HelpCircle className="w-3.5 h-3.5" />
            </button>

            {isOpen && (
                <div
                    ref={popupRef}
                    className={cn(
                        "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[100]", // Center screen
                        "w-[90%] max-w-sm p-5 rounded-2xl",
                        "bg-white/90 dark:bg-gray-900/90 backdrop-blur-xl",
                        "border border-white/20 dark:border-white/10 shadow-2xl",
                        "animate-in fade-in zoom-in duration-200"
                    )}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className="flex justify-between items-start mb-2">
                        <div className="flex items-center gap-2 text-primary font-bold">
                            <HelpCircle className="w-4 h-4" />
                            <span>{t('help.title')}</span>
                        </div>
                        <button
                            onClick={() => setIsOpen(false)}
                            className="p-1 rounded-full hover:bg-black/5 dark:hover:bg-white/5 transition-colors"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                    <div className="text-sm leading-relaxed text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                        {text}
                    </div>
                    <div className="mt-4 flex justify-end">
                        <button
                            onClick={() => setIsOpen(false)}
                            className="px-4 py-1.5 rounded-lg bg-primary text-white text-xs font-medium hover:opacity-90 transition-opacity"
                        >
                            {t('help.close')}
                        </button>
                    </div>
                </div>
            )}

            {/* Backdrop */}
            {isOpen && (
                <div
                    className="fixed inset-0 bg-black/20 backdrop-blur-[2px] z-[90]"
                    onClick={() => setIsOpen(false)}
                />
            )}
        </div>
    );
}
