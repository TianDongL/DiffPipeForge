import { GlassCard } from './ui/GlassCard';
import { GlassButton } from './ui/GlassButton';
import { useTranslation } from 'react-i18next';
import { Star, Github, Info, X } from 'lucide-react';
import { useMemo } from 'react';
import i18n from 'i18next';
import wxImg from '../../wx.jpg';
import zfbImg from '../../zfb.jpg';
import qrImg from '../../qr-code.png';

function parseDonationText(text: string) {
    const parts = text.split(/\[([^\]]+)\]\(([^)]+)\)/g);
    return parts.map((part, index) => {
        if (index % 3 === 0) {
            return part;
        } else if (index % 3 === 1) {
            return null;
        } else {
            const url = part;
            const text = parts[index - 1];
            return (
                <a
                    key={index}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-yellow-400 hover:text-yellow-300 hover:underline"
                >
                    {text}
                </a>
            );
        }
    });
}

interface AboutModalProps {
    isOpen: boolean;
    onClose: () => void;
}

export function AboutModal({ isOpen, onClose }: AboutModalProps) {
    const { t } = useTranslation();

    const donationTextParts = useMemo(() => parseDonationText(t('about.donated_msg')), [t]);

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-md animate-in fade-in duration-300">
            <div className="absolute inset-0" onClick={onClose} />
            <GlassCard className="w-full max-w-lg p-0 overflow-hidden m-4 shadow-2xl border-white/20 relative animate-in zoom-in-95 duration-300">
                <div className="p-6 pb-4 flex items-center justify-between border-b border-white/10 bg-white/5">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-500/20 rounded-lg text-indigo-400">
                            <Info className="w-5 h-5" />
                        </div>
                        <h3 className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-white/70">
                            {t('about.title')}
                        </h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-white/10 rounded-full transition-colors text-muted-foreground hover:text-white"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="p-6 space-y-8">
                    <div className="flex items-center gap-6">
                        <img src="icon.ico" alt="Logo" className="w-20 h-20 rounded-2xl shadow-2xl border-2 border-white/20" />
                        <div className="space-y-1">
                            <h4 className="text-2xl font-black tracking-tight text-white">DiffPipeForge</h4>
                            <div className="flex flex-col gap-1 text-sm">
                                <p className="text-muted-foreground flex items-center gap-2">
                                    <span className="font-semibold text-white/80">{t('about.author')}:</span>
                                    <a
                                        href="https://space.bilibili.com/32275117"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-indigo-400 hover:underline flex items-center gap-1"
                                    >
                                        天冬 (bilibili)
                                    </a>
                                </p>
                                <p className="text-muted-foreground">
                                    <span className="font-semibold text-white/80">{t('about.version')}:</span>
                                    <span className="ml-2 px-2 py-0.5 bg-white/10 rounded-full text-xs font-mono text-indigo-300 border border-white/10">v{import.meta.env.VITE_APP_VERSION || '0.0.0'}</span>
                                </p>
                            </div>
                        </div>
                    </div>

                    {/* Donation Section */}
                    <div className="relative group">
                        <div className="absolute -inset-1 bg-gradient-to-r from-pink-500 to-indigo-500 rounded-3xl blur opacity-25 group-hover:opacity-40 transition duration-1000 group-hover:duration-200"></div>
                        <GlassCard className="relative p-6 bg-white/5 border-white/10 overflow-hidden">
                            <div className="flex items-start gap-4">
                                <div className="p-3 bg-yellow-500/20 rounded-xl text-yellow-500">
                                    <Star className="w-6 h-6 fill-current animate-twinkle" />
                                </div>
                                <div className="space-y-3">
                                    <p className="text-sm leading-relaxed text-white/90">
                                        {donationTextParts}
                                    </p>

                                    {i18n.language === 'zh' ? (
                                        <div className="grid grid-cols-2 gap-4 mt-4">
                                            <div className="aspect-square bg-white/10 rounded-xl flex flex-col items-center justify-center border border-white/5 hover:bg-white/15 transition-colors group/qr cursor-pointer overflow-hidden">
                                                <img src={wxImg} alt="WeChat QR Code" className="w-full h-full object-cover" />
                                                <span className="absolute bottom-2 text-xs text-white/60">{t('about.wechat')}</span>
                                            </div>
                                            <div className="aspect-square bg-white/10 rounded-xl flex flex-col items-center justify-center border border-white/5 hover:bg-white/15 transition-colors group/qr cursor-pointer overflow-hidden">
                                                <img src={zfbImg} alt="Alipay QR Code" className="w-full h-full object-cover" />
                                                <span className="absolute bottom-2 text-xs text-white/60">{t('about.alipay')}</span>
                                            </div>
                                        </div>
                                    ) : (
                                        <a
                                            href="https://buymeacoffee.com/tiandong"
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="block mt-4 w-48 mx-auto aspect-square bg-white/10 rounded-xl border border-white/5 overflow-hidden hover:bg-white/15 transition-colors"
                                        >
                                            <img src={qrImg} alt="Buy Me a Coffee" className="w-full h-full object-contain" />
                                        </a>
                                    )}
                                </div>
                            </div>

                            {/* Decorative background circle */}
                            <div className="absolute -right-10 -bottom-10 w-32 h-32 bg-indigo-500/10 rounded-full blur-3xl"></div>
                        </GlassCard>
                    </div>

                    {/* Footer / Links */}
                    <div className="flex justify-center gap-6 pt-2">
                        <GlassButton
                            variant="ghost"
                            size="sm"
                            className="text-xs text-muted-foreground hover:text-white"
                            onClick={() => window.ipcRenderer.invoke('open-external', 'https://github.com/TianDongL/DiffPipeForge')}
                        >
                            <Github className="w-4 h-4 mr-2" />
                            Official Website
                        </GlassButton>
                    </div>
                </div>
            </GlassCard>
        </div>
    );
}
