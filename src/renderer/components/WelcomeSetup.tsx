import { useState, useMemo, useEffect, useRef, useCallback } from 'react';
import { Download, CheckCircle2, Sparkles, Coffee, Shield, Zap, ChevronRight, Battery, Gauge } from 'lucide-react';
import { useModelStatus } from '../hooks/useModelStatus';
import { cn } from '../lib/utils';
import mascot from '../assets/cocoa-mascot.png';

interface WelcomeSetupProps {
    onComplete?: () => void;
    onSkip?: () => void;
}

interface ModelGroup {
    id: string;
    label: string;
    description: string;
    assets: Array<{ id: string; label: string; exists: boolean; sizeBytes: number | null }>;
    ready: boolean;
    icon: React.ReactNode;
}

function groupAssets(assets: Array<{ id: string; label: string; exists: boolean; sizeBytes: number | null }>): ModelGroup[] {
    const groups: Record<string, ModelGroup> = {};

    assets.forEach(asset => {
        let groupId = 'other';
        let groupLabel = 'Additional Models';
        let description = 'Supporting AI components';
        let icon = <Sparkles className="h-5 w-5" />;

        if (asset.id.includes('vlm') || asset.id.includes('mmproj')) {
            groupId = 'vlm';
            groupLabel = 'Vision & Language';
            description = 'Understands images and text';
            icon = <Sparkles className="h-5 w-5" />;
        } else if (asset.id.includes('embedding')) {
            groupId = 'embedding';
            groupLabel = 'Memory & Search';
            description = 'Enables smart document search';
            icon = <Zap className="h-5 w-5" />;
        } else if (asset.id.includes('reranker') || asset.id.includes('bge')) {
            groupId = 'reranker';
            groupLabel = 'Accuracy Boost';
            description = 'Improves search precision';
            icon = <Shield className="h-5 w-5" />;
        }

        if (!groups[groupId]) {
            groups[groupId] = {
                id: groupId,
                label: groupLabel,
                description,
                assets: [],
                ready: true,
                icon
            };
        }

        groups[groupId].assets.push(asset);
        if (!asset.exists) {
            groups[groupId].ready = false;
        }
    });

    const order = ['vlm', 'embedding', 'reranker', 'other'];
    return Object.values(groups).sort((a, b) => {
        const aIdx = order.indexOf(a.id);
        const bIdx = order.indexOf(b.id);
        return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
    });
}

export function WelcomeSetup({ onComplete, onSkip }: WelcomeSetupProps) {
    const { modelStatus, modelDownloadEvent, modelsReady, presets, loadPresets, applyPreset, selectedPreset, loadRecommendedPreset, recommendedPreset, handleDownloadSelectedModels } = useModelStatus();
    const [currentStep, setCurrentStep] = useState<'welcome' | 'downloading' | 'complete'>('welcome');
    const [hasStartedDownload, setHasStartedDownload] = useState(false);
    const [isApplyingPreset, setIsApplyingPreset] = useState(false);
    const pendingPresetRef = useRef<Promise<void> | null>(null);

    const isDownloading = modelDownloadEvent?.state === 'downloading';
    const downloadComplete = modelDownloadEvent?.state === 'completed';

    // Update step based on download state
    useEffect(() => {
        if (isDownloading) {
            setCurrentStep('downloading');
        } else if (downloadComplete || modelsReady) {
            setCurrentStep('complete');
        }
    }, [isDownloading, downloadComplete, modelsReady]);

    // Trigger onComplete when models are ready
    useEffect(() => {
        if (modelsReady && hasStartedDownload) {
            const timer = setTimeout(() => {
                onComplete?.();
            }, 2000);
            return () => clearTimeout(timer);
        }
    }, [modelsReady, hasStartedDownload, onComplete]);

    const modelGroups = useMemo(() => {
        if (!modelStatus?.assets) return [];
        return groupAssets(modelStatus.assets);
    }, [modelStatus?.assets]);

    const totalSize = useMemo(() => {
        if (!modelStatus?.assets) return 0;
        return modelStatus.assets.reduce((sum, a) => sum + (a.sizeBytes || 0), 0);
    }, [modelStatus?.assets]);

    const totalSizeGB = (totalSize / 1024 / 1024 / 1024).toFixed(1);

    // Track if initial preset has been applied
    const hasAppliedInitialPreset = useRef(false);

    // Wrapper to track preset application
    const handlePresetSelect = useCallback(async (presetId: string) => {
        setIsApplyingPreset(true);
        const presetPromise = applyPreset(presetId as any);
        pendingPresetRef.current = presetPromise;
        try {
            await presetPromise;
        } finally {
            setIsApplyingPreset(false);
            pendingPresetRef.current = null;
        }
    }, [applyPreset]);

    // Load presets on mount - run only once
    useEffect(() => {
        if (hasAppliedInitialPreset.current) return;

        loadPresets();
        loadRecommendedPreset().then(presetId => {
            // If we have a recommended preset and no selection yet, apply it
            if (presetId && !hasAppliedInitialPreset.current) {
                hasAppliedInitialPreset.current = true;
                handlePresetSelect(presetId);
            }
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const handleStartDownload = async () => {
        // Wait for any pending preset application to complete
        if (pendingPresetRef.current) {
            await pendingPresetRef.current;
        }
        setHasStartedDownload(true);
        handleDownloadSelectedModels();
    };

    return (
        <div className="flex flex-col h-full overflow-hidden">
            {/* Header with warm gradient */}
            <div className="relative px-8 pt-10 pb-8 bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50 dark:from-amber-950/30 dark:via-orange-950/20 dark:to-yellow-950/20 border-b border-amber-200/50 dark:border-amber-800/30">
                {/* Decorative elements */}
                <div className="absolute top-0 right-0 w-32 h-32 opacity-10">
                    <img src={mascot} alt="" className="w-full h-full object-contain" />
                </div>

                <div className="relative z-10 flex items-start gap-5">
                    <div className="shrink-0 w-16 h-16 rounded-2xl bg-gradient-to-br from-amber-400 to-orange-500 shadow-lg flex items-center justify-center">
                        <Coffee className="h-8 w-8 text-white" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h1 className="text-2xl font-bold text-amber-900 dark:text-amber-100 mb-2">
                            {currentStep === 'welcome' && "Welcome to Local Cocoa"}
                            {currentStep === 'downloading' && "Downloading AI Models"}
                            {currentStep === 'complete' && "You're All Set!"}
                        </h1>
                        <p className="text-amber-700 dark:text-amber-300/80 text-sm leading-relaxed">
                            {currentStep === 'welcome' && "Let's get you set up with powerful AI that runs entirely on your device. Your data stays private, always."}
                            {currentStep === 'downloading' && "Sit back and relax while we download the AI models. This only happens once."}
                            {currentStep === 'complete' && "All AI models are ready. You can now use Local Cocoa to its full potential."}
                        </p>
                    </div>
                </div>

                {/* Step indicator */}
                <div className="flex items-center gap-2 mt-6">
                    {['welcome', 'downloading', 'complete'].map((step, idx) => (
                        <div key={step} className="flex items-center">
                            <div className={cn(
                                "h-2 rounded-full transition-all duration-500",
                                step === currentStep ? "w-8 bg-amber-500" :
                                    ['welcome', 'downloading', 'complete'].indexOf(currentStep) > idx
                                        ? "w-2 bg-amber-400"
                                        : "w-2 bg-amber-200 dark:bg-amber-800"
                            )} />
                            {idx < 2 && <div className="w-2" />}
                        </div>
                    ))}
                </div>
            </div>

            {/* Content area */}
            <div className="flex-1 overflow-y-auto p-8">
                {currentStep === 'welcome' && (
                    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
                        {/* What we'll download */}
                        <div>

                            {/* Preset Selection */}
                            <div>
                                <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                                    <Sparkles className="h-4 w-4 text-amber-500" />
                                    Choose Performance Profile
                                </h3>
                                <div className="grid grid-cols-3 gap-3 mb-6">
                                    {presets && Object.entries(presets.presets).map(([id, preset]) => {
                                        const isRecommended = recommendedPreset === id;
                                        return (
                                            <button
                                                key={id}
                                                onClick={() => handlePresetSelect(id)}
                                                className={cn(
                                                    "relative flex flex-col items-start gap-2 p-3 rounded-xl border text-left transition-all hover:bg-accent/50 hover:border-amber-200",
                                                    selectedPreset === id
                                                        ? "border-amber-500 bg-amber-50 dark:bg-amber-950/20 ring-1 ring-amber-500/20"
                                                        : "bg-card/50",
                                                    isRecommended && selectedPreset !== id && "border-emerald-500/50 ring-1 ring-emerald-500/20"
                                                )}
                                            >
                                                {isRecommended && (
                                                    <div className="absolute -top-2.5 left-1/2 -translate-x-1/2 bg-emerald-500 text-white text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm whitespace-nowrap z-10">
                                                        Recommended
                                                    </div>
                                                )}
                                                <div className="flex items-center justify-between w-full mt-1">
                                                    <span className="font-medium text-sm capitalize">{id}</span>
                                                    {id === 'eco' && <Battery className="h-4 w-4 text-emerald-500" />}
                                                    {id === 'balanced' && <Zap className="h-4 w-4 text-amber-500" />}
                                                    {id === 'pro' && <Gauge className="h-4 w-4 text-red-500" />}
                                                </div>
                                                <p className="text-[10px] text-muted-foreground leading-snug">
                                                    {preset.description}
                                                </p>
                                                <div className="flex items-center gap-2 mt-auto pt-2 w-full border-t border-border/30">
                                                    <span className="text-[10px] font-mono text-muted-foreground">
                                                        ~{preset.estimatedVram} VRAM
                                                    </span>
                                                </div>
                                                {selectedPreset === id && (
                                                    <div className="absolute top-2 right-2">
                                                        <CheckCircle2 className="h-4 w-4 text-amber-500" />
                                                    </div>
                                                )}
                                            </button>
                                        );
                                    })}
                                </div>

                                <h3 className="text-sm font-semibold text-foreground mb-4 flex items-center gap-2">
                                    <Download className="h-4 w-4 text-amber-500" />
                                    Included Models
                                </h3>
                                <div className="grid gap-3">
                                    {modelGroups.map((group, idx) => (
                                        <div
                                            key={group.id}
                                            className={cn(
                                                "flex flex-col gap-3 p-4 rounded-xl border bg-card/50 transition-all duration-300",
                                                "hover:bg-card hover:shadow-sm",
                                                "animate-in fade-in slide-in-from-left-4"
                                            )}
                                            style={{ animationDelay: `${idx * 100}ms` }}
                                        >
                                            <div className="flex items-center gap-4">
                                                <div className={cn(
                                                    "shrink-0 w-10 h-10 rounded-lg flex items-center justify-center",
                                                    group.ready
                                                        ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
                                                        : "bg-amber-100 text-amber-600 dark:bg-amber-900/30 dark:text-amber-400"
                                                )}>
                                                    {group.ready ? <CheckCircle2 className="h-5 w-5" /> : group.icon}
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <p className="font-medium text-sm">{group.label}</p>
                                                    <p className="text-xs text-muted-foreground">{group.description}</p>
                                                </div>
                                                <div className={cn(
                                                    "shrink-0 text-xs font-medium px-2 py-1 rounded-full",
                                                    group.ready
                                                        ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                                                        : "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400"
                                                )}>
                                                    {group.ready ? "Ready" : "Required"}
                                                </div>
                                            </div>

                                            {/* Detailed Asset List */}
                                            <div className="pl-[3.5rem] space-y-1.5">
                                                {group.assets.sort((a, b) => (b.exists ? 1 : 0) - (a.exists ? 1 : 0)).map(asset => (
                                                    <div key={asset.id} className="flex items-center justify-between text-xs p-1.5 rounded-lg bg-muted/40 border border-transparent hover:border-border/50 transition-colors">
                                                        <div className="flex items-center gap-2 min-w-0">
                                                            <div className={cn(
                                                                "w-1.5 h-1.5 rounded-full shrink-0",
                                                                asset.exists ? "bg-emerald-500" : "bg-amber-400"
                                                            )} />
                                                            <span className="truncate font-medium text-muted-foreground" title={asset.label}>
                                                                {asset.label}
                                                            </span>
                                                        </div>
                                                        <div className="flex items-center gap-2 shrink-0 ml-2">
                                                            {asset.sizeBytes && (
                                                                <span className="text-[10px] text-muted-foreground/70 font-mono">
                                                                    {(asset.sizeBytes / 1024 / 1024).toFixed(0)} MB
                                                                </span>
                                                            )}
                                                            <span className={cn(
                                                                "text-[10px] px-1.5 py-0.5 rounded-md font-medium",
                                                                asset.exists
                                                                    ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
                                                                    : "bg-amber-500/10 text-amber-600 dark:text-amber-400"
                                                            )}>
                                                                {asset.exists ? "Installed" : "Missing"}
                                                            </span>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Storage info */}
                        <div className="flex items-center gap-3 p-4 rounded-xl bg-muted/50 border border-border/50">
                            <div className="shrink-0 w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center">
                                <Shield className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                            </div>
                            <div className="flex-1">
                                <p className="text-sm font-medium">Download Size: ~{totalSizeGB} GB</p>
                                <p className="text-xs text-muted-foreground">
                                    Models are stored locally. Your data never leaves your device.
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {currentStep === 'downloading' && (
                    <div className="space-y-6 animate-in fade-in duration-500">
                        {/* Progress indicator */}
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-medium">
                                    {modelDownloadEvent?.message || 'Preparing download...'}
                                </span>
                                <span className="text-sm font-mono text-muted-foreground">
                                    {Math.round(modelDownloadEvent?.percent ?? 0)}%
                                </span>
                            </div>
                            <div className="h-3 w-full overflow-hidden rounded-full bg-muted">
                                <div
                                    className="h-full bg-gradient-to-r from-amber-400 to-orange-500 transition-all duration-300 ease-out"
                                    style={{ width: `${modelDownloadEvent?.percent ?? 0}%` }}
                                />
                            </div>
                        </div>

                        {/* Model status cards */}
                        <div className="grid gap-3">
                            {modelGroups.map((group) => {
                                const isCurrentGroup = modelDownloadEvent?.assetId?.includes(group.id);
                                return (
                                    <div
                                        key={group.id}
                                        className={cn(
                                            "flex items-center gap-4 p-4 rounded-xl border transition-all",
                                            isCurrentGroup
                                                ? "bg-amber-50 border-amber-200 dark:bg-amber-950/20 dark:border-amber-800"
                                                : "bg-card/50"
                                        )}
                                    >
                                        <div className={cn(
                                            "shrink-0 w-10 h-10 rounded-lg flex items-center justify-center",
                                            group.ready
                                                ? "bg-emerald-100 text-emerald-600 dark:bg-emerald-900/30 dark:text-emerald-400"
                                                : isCurrentGroup
                                                    ? "bg-amber-200 dark:bg-amber-800"
                                                    : "bg-muted"
                                        )}>
                                            {group.ready ? (
                                                <CheckCircle2 className="h-5 w-5" />
                                            ) : isCurrentGroup ? (
                                                <div className="h-5 w-5 rounded-full border-2 border-amber-600 border-t-transparent animate-spin" />
                                            ) : (
                                                <div className="h-2 w-2 rounded-full bg-muted-foreground/30" />
                                            )}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-medium text-sm">{group.label}</p>
                                            <p className="text-xs text-muted-foreground">
                                                {group.ready ? "Complete" : isCurrentGroup ? "Downloading..." : "Waiting"}
                                            </p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>

                        {/* Tip */}
                        <div className="flex items-start gap-3 p-4 rounded-xl bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800">
                            <Coffee className="h-5 w-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
                            <div>
                                <p className="text-sm font-medium text-blue-900 dark:text-blue-100">Grab a coffee ☕</p>
                                <p className="text-xs text-blue-700 dark:text-blue-300">
                                    This download happens only once. Future launches will be much faster.
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {currentStep === 'complete' && (
                    <div className="flex flex-col items-center justify-center py-8 animate-in fade-in zoom-in-95 duration-500">
                        <div className="w-20 h-20 rounded-full bg-gradient-to-br from-emerald-400 to-green-500 flex items-center justify-center mb-6 shadow-lg">
                            <CheckCircle2 className="h-10 w-10 text-white" />
                        </div>
                        <h3 className="text-xl font-bold mb-2">Setup Complete!</h3>
                        <p className="text-muted-foreground text-center max-w-sm mb-6">
                            Local Cocoa is ready to help you search, understand, and interact with your documents using AI.
                        </p>
                        <div className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400">
                            <Sparkles className="h-4 w-4" />
                            <span>All AI models are installed and ready</span>
                        </div>
                    </div>
                )}
            </div>

            {/* Footer with action button */}
            <div className="shrink-0 p-6 border-t bg-muted/30">
                {currentStep === 'welcome' && (
                    <div className="space-y-3">
                        <button
                            onClick={handleStartDownload}
                            disabled={isApplyingPreset}
                            className={cn(
                                "w-full flex items-center justify-center gap-3 py-4 px-6 rounded-xl",
                                "bg-gradient-to-r from-amber-500 to-orange-500 hover:from-amber-600 hover:to-orange-600",
                                "text-white font-semibold text-base shadow-lg",
                                "transition-all duration-200 hover:shadow-xl hover:scale-[1.02]",
                                "focus:outline-none focus:ring-2 focus:ring-amber-500 focus:ring-offset-2",
                                "disabled:opacity-60 disabled:cursor-not-allowed disabled:hover:scale-100"
                            )}
                        >
                            <Download className="h-5 w-5" />
                            {isApplyingPreset ? 'Applying preset...' : 'Download AI Models'}
                            <ChevronRight className="h-5 w-5 ml-1" />
                        </button>
                        {onSkip && (
                            <button
                                onClick={onSkip}
                                className="w-full flex items-center justify-center gap-2 py-3 px-6 rounded-xl text-sm text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
                            >
                                Skip — I&apos;ll use external endpoints instead
                                <ChevronRight className="h-4 w-4" />
                            </button>
                        )}
                    </div>
                )}

                {currentStep === 'downloading' && (
                    <div className="text-center">
                        <p className="text-sm text-muted-foreground">
                            Please don&apos;t close the app while downloading...
                        </p>
                    </div>
                )}

                {currentStep === 'complete' && (
                    <button
                        onClick={onComplete}
                        className={cn(
                            "w-full flex items-center justify-center gap-3 py-4 px-6 rounded-xl",
                            "bg-gradient-to-r from-emerald-500 to-green-500 hover:from-emerald-600 hover:to-green-600",
                            "text-white font-semibold text-base shadow-lg",
                            "transition-all duration-200 hover:shadow-xl hover:scale-[1.02]",
                            "focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
                        )}
                    >
                        <Sparkles className="h-5 w-5" />
                        Get Started
                        <ChevronRight className="h-5 w-5 ml-1" />
                    </button>
                )}
            </div>
        </div>
    );
}

