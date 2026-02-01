import React from 'react';
import { cn } from '@/lib/utils';
import { useGlassToast } from './GlassToast';
import { useTranslation } from 'react-i18next';
import { HelpIcon } from './HelpIcon';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
    label?: string;
    error?: string;
    onSave?: () => void;  // Callback when user presses Enter or blurs (commits the change)
    helpText?: string;
}

const GlassInput = React.forwardRef<HTMLInputElement, InputProps>(
    ({ className, type, label, error, onSave, helpText, ...props }, ref) => {
        // Try/catch for hook usage in case it's used outside provider (though we will add provider globally)
        let showToast: ((msg: string) => void) | undefined;
        try {
            const toast = useGlassToast();
            showToast = toast.showToast;
        } catch (e) {
            // Ignore if not in provider
        }

        const { t } = useTranslation();

        return (
            <div className="w-full space-y-2">
                {label && (
                    <div className="flex items-center gap-1.5">
                        <label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70 text-gray-700 dark:text-gray-300">
                            {label}
                        </label>
                        {helpText && <HelpIcon text={helpText} />}
                    </div>
                )}
                <input
                    type={type}
                    className={cn(
                        "block w-full appearance-none rounded-lg border px-3 py-2.5 text-sm",
                        "bg-white/40 dark:bg-white/5 backdrop-blur-md",
                        "border-gray-200 dark:border-white/10",
                        "placeholder:text-gray-400 dark:placeholder:text-gray-500",
                        "focus-visible:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50",
                        "disabled:cursor-not-allowed disabled:opacity-50",
                        "transition-all duration-200 shadow-sm hover:border-gray-300 dark:hover:border-white/20",
                        className
                    )}
                    ref={ref}
                    onBlur={(e) => {
                        if (type === 'number' && e.target.value) {
                            let val = parseFloat(e.target.value);
                            if (!isNaN(val)) {
                                let formatted: string;

                                // Auto-correct negative values to 0
                                if (val < 0) {
                                    val = 0;
                                    formatted = "0";
                                    if (showToast) showToast(t('common.auto_corrected_to_zero'));
                                } else {
                                    formatted = val.toFixed(20).replace(/\.?0+$/, "");
                                }

                                // Only update if different
                                if (formatted !== e.target.value) {
                                    // Create a synthetic event
                                    const newEvent = {
                                        ...e,
                                        target: {
                                            ...e.target,
                                            value: formatted,
                                            name: e.target.name
                                        }
                                    };
                                    props.onChange?.(newEvent as React.ChangeEvent<HTMLInputElement>);
                                }
                            }
                        }
                        // Trigger onSave callback when blurring (user commits the change)
                        onSave?.();
                        props.onBlur?.(e);
                    }}
                    onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                            (e.target as HTMLInputElement).blur();
                        }
                        props.onKeyDown?.(e);
                    }}
                    {...props}
                />
                {error && <p className="text-xs text-red-500 font-medium ml-1">{error}</p>}
            </div>
        );
    }
);
GlassInput.displayName = "GlassInput";

export { GlassInput };
