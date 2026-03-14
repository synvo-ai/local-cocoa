import { X } from 'lucide-react';
import { ModelManagement } from '../ModelManagement';
import { WelcomeSetup } from '../WelcomeSetup';
import { useModelStatus } from '../../hooks/useModelStatus';

interface ModelManagerModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSkipSetup?: () => void;
}

export function ModelManagerModal({ isOpen, onClose, onSkipSetup }: ModelManagerModalProps) {
    const { modelsReady } = useModelStatus();

    if (!isOpen) return null;

    // Show warm welcome setup when models are not ready
    if (!modelsReady) {
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" style={{ WebkitAppRegion: 'no-drag' } as any}>
                <div className="relative w-full max-w-2xl h-[85vh] rounded-2xl border bg-background shadow-2xl overflow-hidden animate-in fade-in zoom-in-95 duration-300">
                    <WelcomeSetup onComplete={onClose} onSkip={onSkipSetup} />
                </div>
            </div>
        );
    }

    // Show regular model management when models are ready
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" style={{ WebkitAppRegion: 'no-drag' } as any}>
            <div className="relative w-full max-w-4xl rounded-2xl border bg-background p-6 shadow-2xl max-h-[90vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-300">
                <button
                    onClick={onClose}
                    className="absolute right-4 top-4 rounded-full p-2 hover:bg-muted transition-colors z-10"
                >
                    <X className="h-5 w-5" />
                </button>
                <div className="mb-6">
                    <h2 className="text-2xl font-semibold">Model Configuration</h2>
                    <p className="text-muted-foreground">
                        Manage your local AI models and settings.
                    </p>
                </div>
                <ModelManagement />
            </div>
        </div>
    );
}
