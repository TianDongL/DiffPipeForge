import { Database, Activity, Moon, Sun, Settings, Cpu, Rocket, Star } from 'lucide-react';

import { GlassCard } from './ui/GlassCard';
import { cn } from '@/lib/utils';
import { NavItem } from './Layout';
import { GlassButton } from './ui/GlassButton';

import { useTranslation } from "react-i18next";
import { useState } from 'react';
import { AboutModal } from './AboutModal';

interface SidebarProps {
    activeTab: NavItem;
    onTabChange: (tab: NavItem) => void;
    theme: 'light' | 'dark';
    onThemeToggle: () => void;
}

export function Sidebar({ activeTab, onTabChange, theme, onThemeToggle }: SidebarProps) {
    const { t, i18n } = useTranslation();

    const navItems = [
        { id: 'dataset', label: t('nav.dataset'), icon: Database },
        { id: 'eval_dataset', label: t('nav.eval_dataset'), icon: Database },
        { id: 'training_setup', label: t('nav.training_setup'), icon: Settings },
        { id: 'training_run', label: t('nav.training_run'), icon: Rocket },
        { id: 'monitor', label: t('nav.monitor'), icon: Activity },
        { id: 'resource_monitor', label: t('nav.resource_monitor'), icon: Cpu },
    ] as const;

    const [isAboutModalOpen, setIsAboutModalOpen] = useState(false);

    return (
        <aside className="w-64 h-full p-4 hidden md:flex flex-col gap-4 z-20">
            {/* Logo Area */}
            <GlassCard className="p-4 flex items-center gap-3 bg-white/80 dark:bg-black/60">
                <img src="icon.ico" alt="Logo" className="w-8 h-8 rounded-lg shadow-lg" />
                <div>
                    <h2 className="font-bold text-sm tracking-wide">{t('app.title')}</h2>
                    <a
                        href="https://space.bilibili.com/32275117"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-muted-foreground font-medium hover:text-primary transition-colors hover:underline"
                    >
                        {t('app.subtitle')}
                    </a>
                </div>
            </GlassCard>

            {/* Navigation */}
            <GlassCard className="flex-1 flex flex-col p-2 gap-1 overflow-y-auto">
                <div className="text-xs font-semibold text-muted-foreground px-3 py-2 uppercase tracking-wider">
                    {t('nav.main_menu')}
                </div>
                {navItems.map((item) => (
                    <div key={item.id} className="flex flex-col gap-1">
                        <button
                            onClick={() => onTabChange(item.id)}
                            className={cn(
                                "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200",
                                activeTab === item.id
                                    ? "bg-primary text-primary-foreground shadow-md"
                                    : "text-muted-foreground hover:bg-white/10 hover:text-foreground"
                            )}
                        >
                            <item.icon className="w-4 h-4" />
                            {item.label}
                        </button>
                        {item.id === 'training_setup' && (
                            <div className="h-px bg-white/10 dark:bg-white/5 mx-2 my-1" />
                        )}
                    </div>
                ))}
            </GlassCard>

            <AboutModal isOpen={isAboutModalOpen} onClose={() => setIsAboutModalOpen(false)} />

            {/* Theme Toggle & Footer */}
            <GlassCard className="p-4">
                <div className="flex items-center justify-between border-b border-border/50 pb-3 mb-3">
                    <span className="text-xs font-medium text-muted-foreground">{t('common.language')}</span>
                    <GlassButton
                        variant="ghost"
                        size="sm"
                        onClick={() => i18n.changeLanguage(i18n.language === 'en' ? 'zh' : 'en')}
                        className="h-8 text-xs font-medium px-2 min-w-[3rem]"
                    >
                        {i18n.language === 'en' ? '中文' : 'EN'}
                    </GlassButton>
                </div>
                <div className="flex items-center justify-between border-b border-border/50 pb-3 mb-3">
                    <span className="text-xs font-medium text-muted-foreground">{t('theme.label')}</span>
                    <GlassButton
                        variant="ghost"
                        size="icon"
                        onClick={onThemeToggle}
                        className="w-8 h-8 rounded-full"
                    >
                        {theme === 'dark' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                    </GlassButton>
                </div>

                {/* About Trigger at the very bottom */}
                <button
                    onClick={() => setIsAboutModalOpen(true)}
                    className="w-full flex items-center justify-start gap-2 px-2 py-1.5 rounded-lg text-[10px] font-medium text-muted-foreground hover:bg-white/5 hover:text-foreground transition-all duration-200 group"
                >
                    <Star className="w-3 h-3 text-yellow-400/50 group-hover:text-yellow-400 animate-twinkle fill-yellow-400/20" />
                    <span>{t('common.about')}</span>
                </button>
            </GlassCard>
        </aside>
    );
}
