import { Trash2, AlertTriangle, Info, X } from 'lucide-react';
import { cn } from '../../lib/utils';

export interface ConfirmModalProps {
    isOpen: boolean;
    title: string;
    message: React.ReactNode;
    confirmText?: string;
    cancelText?: string;
    onConfirm: () => void;
    onClose: () => void;
    variant?: 'destructive' | 'warning' | 'info';
}

export function ConfirmModal({
    isOpen,
    title,
    message,
    confirmText = 'Confirm',
    cancelText = 'Cancel',
    onConfirm,
    onClose,
    variant = 'destructive'
}: ConfirmModalProps) {
    if (!isOpen) return null;

    const getIcon = () => {
        switch (variant) {
            case 'warning': return <AlertTriangle className="h-8 w-8 text-amber-500" />;
            case 'info': return <Info className="h-8 w-8 text-blue-500" />;
            case 'destructive': 
            default: return <Trash2 className="h-8 w-8 text-destructive" />;
        }
    };

    const getIconBg = () => {
        switch (variant) {
            case 'warning': return 'bg-amber-100 dark:bg-amber-900/30';
            case 'info': return 'bg-blue-100 dark:bg-blue-900/30';
            case 'destructive':
            default: return 'bg-destructive/10';
        }
    };

    const getConfirmBtnClass = () => {
        switch (variant) {
            case 'warning': return 'bg-amber-500 text-white hover:bg-amber-600 shadow-amber-500/20';
            case 'info': return 'bg-blue-500 text-white hover:bg-blue-600 shadow-blue-500/20';
            case 'destructive':
            default: return 'bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-destructive/20';
        }
    };

    return (
        <div 
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 backdrop-blur-[2px] animate-in fade-in duration-200"
            onClick={(e) => {
                if (e.target === e.currentTarget) onClose();
            }}
            style={{ WebkitAppRegion: 'no-drag' } as any}
        >
            <div 
                className="bg-background rounded-3xl border shadow-2xl max-w-sm w-full p-8 relative animate-in zoom-in-95 fade-in duration-300 transform-gpu"
                onClick={e => e.stopPropagation()}
            >
                <button
                    onClick={onClose}
                    className="absolute right-4 top-4 rounded-full p-1.5 hover:bg-accent text-muted-foreground transition-colors"
                >
                    <X className="h-4 w-4" />
                </button>

                <div className={cn("h-16 w-16 rounded-2xl flex items-center justify-center mb-6 mx-auto", getIconBg())}>
                    {getIcon()}
                </div>
                
                <h3 className="text-xl font-bold text-center mb-2">{title}</h3>
                <div className="text-center text-muted-foreground text-sm mb-8 leading-relaxed">
                    {message}
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <button
                        onClick={onClose}
                        className="px-6 py-3 rounded-2xl text-sm font-semibold border bg-background hover:bg-accent transition-all duration-200 active:scale-95 text-foreground"
                    >
                        {cancelText}
                    </button>
                    <button
                        onClick={() => {
                            onConfirm();
                            onClose();
                        }}
                        className={cn(
                            "px-6 py-3 rounded-2xl text-sm font-semibold transition-all duration-200 shadow-lg active:scale-95",
                            getConfirmBtnClass()
                        )}
                    >
                        {confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
}
