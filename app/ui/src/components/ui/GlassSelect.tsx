import React from 'react';
import { cn } from '@/lib/utils';
import { ChevronDown } from 'lucide-react';
import { HelpIcon } from './HelpIcon';

export interface SelectOption {
    label: string;
    value: string;
}

export interface GlassSelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
    label?: string;
    options: SelectOption[];
    error?: string;
    helpText?: string;
}

const GlassSelect = React.forwardRef<HTMLSelectElement, GlassSelectProps>(
    ({ className, label, options, error, helpText, ...props }, ref) => {
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
                <div className="relative">
                    <select
                        className={cn(
                            "flex h-10 w-full appearance-none rounded-lg border px-3 py-2 text-sm",
                            "bg-white/40 dark:bg-white/5 backdrop-blur-md",
                            "border-gray-200 dark:border-white/10",
                            "focus-visible:outline-none focus:ring-2 focus:ring-primary/50 focus:border-primary/50",
                            "disabled:cursor-not-allowed disabled:opacity-50",
                            "transition-all duration-200 shadow-sm hover:border-gray-300 dark:hover:border-white/20",
                            className
                        )}
                        ref={ref}
                        {...props}
                    >
                        {options.map((opt) => (
                            <option key={opt.value} value={opt.value} className="bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
                                {opt.label}
                            </option>
                        ))}
                    </select>
                    <ChevronDown className="absolute right-3 top-2.5 h-4 w-4 opacity-50 pointer-events-none" />
                </div>
                {error && <p className="text-xs text-red-500 font-medium ml-1">{error}</p>}
            </div>
        );
    }
);
GlassSelect.displayName = "GlassSelect";

export { GlassSelect };
