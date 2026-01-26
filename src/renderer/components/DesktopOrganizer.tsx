/**
 * DesktopOrganizer - AI-powered desktop file organization
 * 
 * This component allows users to:
 * 1. Scan their desktop for files
 * 2. View AI-generated tags and suggestions
 * 3. Choose an organization strategy
 * 4. Preview and execute the reorganization
 */

import { useState, useCallback, useEffect, CSSProperties } from 'react';
import {
    FolderOpen,
    Scan,
    Sparkles,
    FileType,
    Calendar,
    Clock,
    Wand2,
    FolderTree,
    ChevronRight,
    Check,
    X,
    AlertCircle,
    Loader2,
    ArrowRight,
    Tag,
    File,
    Folder,
    RefreshCw,
    Play,
    Eye,
    Undo2,
    Settings2,
    Brain
} from 'lucide-react';
import { cn } from '../lib/utils';

// Thinking step interface for agent visualization
interface ThinkingStep {
    id: string;
    label: string;
    status: 'pending' | 'active' | 'completed' | 'error';
    detail?: string;
    startTime?: number;
    endTime?: number;
}

// ThinkingPanel component to show agent progress
function ThinkingPanel({ steps, isActive }: { steps: ThinkingStep[]; isActive: boolean }) {
    if (!isActive && steps.length === 0) return null;
    
    return (
        <div className="fixed bottom-6 right-6 w-80 max-h-96 bg-card border rounded-xl shadow-2xl overflow-hidden z-50 animate-in slide-in-from-bottom-4 fade-in duration-300">
            <div className="px-4 py-3 bg-gradient-to-r from-emerald-600/10 to-teal-600/10 border-b flex items-center gap-2">
                <div className="relative">
                    <Brain className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                    {isActive && (
                        <span className="absolute -top-1 -right-1 h-2 w-2 bg-emerald-500 rounded-full animate-pulse" />
                    )}
                </div>
                <span className="text-sm font-semibold">Agent Thinking</span>
                {isActive && (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground ml-auto" />
                )}
            </div>
            <div className="p-3 space-y-2 max-h-72 overflow-y-auto">
                {steps.map((step, idx) => (
                    <div
                        key={step.id}
                        className={cn(
                            "flex items-start gap-3 p-2 rounded-lg transition-all duration-300",
                            step.status === 'active' && "bg-emerald-500/10",
                            step.status === 'completed' && "opacity-70",
                            step.status === 'pending' && "opacity-40"
                        )}
                    >
                        <div className="mt-0.5 shrink-0">
                            {step.status === 'completed' ? (
                                <div className="h-5 w-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
                                    <Check className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                                </div>
                            ) : step.status === 'active' ? (
                                <div className="h-5 w-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
                                    <Loader2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400 animate-spin" />
                                </div>
                            ) : step.status === 'error' ? (
                                <div className="h-5 w-5 rounded-full bg-red-500/20 flex items-center justify-center">
                                    <X className="h-3 w-3 text-red-500" />
                                </div>
                            ) : (
                                <div className="h-5 w-5 rounded-full bg-muted flex items-center justify-center">
                                    <span className="text-[10px] text-muted-foreground">{idx + 1}</span>
                                </div>
                            )}
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className={cn(
                                "text-sm font-medium",
                                step.status === 'active' && "text-emerald-700 dark:text-emerald-300"
                            )}>
                                {step.label}
                            </p>
                            {step.detail && (
                                <p className="text-xs text-muted-foreground mt-0.5 truncate">
                                    {step.detail}
                                </p>
                            )}
                            {step.status === 'completed' && step.startTime && step.endTime && (
                                <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                                    Completed in {((step.endTime - step.startTime) / 1000).toFixed(1)}s
                                </p>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

// Types based on backend models
interface FileTag {
    name: string;
    confidence: number;
    category: string | null;
}

interface DesktopFile {
    id: string;
    name: string;
    path: string;
    extension: string;
    size_bytes: number;
    size_display: string;
    created_at: string;
    modified_at: string;
    is_directory: boolean;
    tags: FileTag[];
    ai_summary: string | null;
    suggested_folder: string | null;
}

interface OrganizeStrategy {
    id: string;
    name: string;
    description: string;
    icon: string;
}

interface MoveAction {
    source: string;
    destination: string;
    file_name: string;
    folder: string;
}

interface OrganizationProposal {
    id: string;
    strategy: string;
    description: string;
    moves: MoveAction[];
    estimated_folders_created: number;
    files_affected: number;
    created_at: string;
}

interface ExecuteResult {
    success: boolean;
    moved: Array<{ from: string; to: string; name: string }>;
    failed: Array<{ file: string; error: string }>;
    folders_created: string[];
    dry_run: boolean;
}

// New response format from scan endpoint
interface ScanResponse {
    files: DesktopFile[];
    ai_analysis_status: 'success' | 'partial' | 'skipped' | 'failed';
    ai_analysis_message: string | null;
}

// Strategy icons
const STRATEGY_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
    'FileType': FileType,
    'Calendar': Calendar,
    'Clock': Clock,
    'Sparkles': Sparkles,
    'Wand': Wand2
};

export function DesktopOrganizer() {
    const [desktopPath, setDesktopPath] = useState<string>('');
    const [files, setFiles] = useState<DesktopFile[]>([]);
    const [strategies, setStrategies] = useState<OrganizeStrategy[]>([]);
    const [selectedStrategy, setSelectedStrategy] = useState<string | null>(null);
    const [currentProposal, setCurrentProposal] = useState<OrganizationProposal | null>(null);
    const [executeResult, setExecuteResult] = useState<ExecuteResult | null>(null);
    
    const [isScanning, setIsScanning] = useState(false);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isProposing, setIsProposing] = useState(false);
    const [isExecuting, setIsExecuting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    
    const [step, setStep] = useState<'scan' | 'analyze' | 'strategy' | 'preview' | 'result'>('scan');
    
    // Agent thinking visualization
    const [thinkingSteps, setThinkingSteps] = useState<ThinkingStep[]>([]);
    const [isThinking, setIsThinking] = useState(false);
    
    // Helper to add/update thinking steps
    const addThinkingStep = useCallback((step: ThinkingStep) => {
        setThinkingSteps(prev => [...prev, step]);
    }, []);
    
    const updateThinkingStep = useCallback((id: string, updates: Partial<ThinkingStep>) => {
        setThinkingSteps(prev => prev.map(s => 
            s.id === id ? { ...s, ...updates } : s
        ));
    }, []);
    
    const clearThinkingSteps = useCallback(() => {
        setThinkingSteps([]);
        setIsThinking(false);
    }, []);
    
    const dragStyle = { WebkitAppRegion: 'drag' } as CSSProperties;
    const noDragStyle = { WebkitAppRegion: 'no-drag' } as CSSProperties;

    // Base URL for backend API
    const API_BASE = 'http://127.0.0.1:8890/plugins/desktop_organizer';

    // Get API key for authentication
    const getApiKey = useCallback(async (): Promise<string> => {
        const apiKey = await (window as any).api?.getLocalKey();
        if (!apiKey) {
            throw new Error('API key not found');
        }
        return apiKey;
    }, []);

    // Authenticated fetch helper
    const fetchApi = useCallback(async <T,>(path: string, options?: RequestInit): Promise<T> => {
        const apiKey = await getApiKey();
        const response = await fetch(`${API_BASE}${path}`, {
            ...options,
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': apiKey,
                ...options?.headers,
            },
        });
        if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API error: ${response.status} - ${errorText}`);
        }
        return response.json();
    }, [getApiKey]);

    // Fetch available strategies
    useEffect(() => {
        const loadStrategies = async () => {
            try {
                const data = await fetchApi<OrganizeStrategy[]>('/strategies');
                setStrategies(data);
            } catch (err) {
                console.error('Failed to fetch strategies:', err);
            }
        };
        loadStrategies();
    }, [fetchApi]);

    // Fetch desktop path
    useEffect(() => {
        const loadPath = async () => {
            try {
                const data = await fetchApi<{ path: string }>('/desktop-path');
                setDesktopPath(data.path);
            } catch (err) {
                console.error('Failed to fetch desktop path:', err);
            }
        };
        loadPath();
    }, [fetchApi]);

    // Scan desktop with thinking visualization
    const handleScan = useCallback(async (analyze: boolean = true) => {
        setIsScanning(true);
        setIsAnalyzing(analyze);
        setError(null);
        setIsThinking(true);
        clearThinkingSteps();
        
        const scanStartTime = Date.now();
        
        // Step 1: Initialize
        const step1: ThinkingStep = {
            id: 'init',
            label: 'Initializing scan',
            status: 'active',
            detail: `Target: ${desktopPath}`,
            startTime: Date.now()
        };
        addThinkingStep(step1);
        
        await new Promise(r => setTimeout(r, 300));
        updateThinkingStep('init', { status: 'completed', endTime: Date.now() });
        
        // Step 2: Scanning files
        const step2: ThinkingStep = {
            id: 'scan',
            label: 'Scanning desktop files',
            status: 'active',
            detail: 'Discovering files and folders...',
            startTime: Date.now()
        };
        addThinkingStep(step2);
        
        try {
            // Start the actual API call
            const fetchPromise = fetchApi<ScanResponse>('/scan', {
                method: 'POST',
                body: JSON.stringify({ analyze })
            });
            
            // Simulate progress updates during the API call
            if (analyze) {
                await new Promise(r => setTimeout(r, 500));
                updateThinkingStep('scan', { 
                    status: 'completed', 
                    endTime: Date.now(),
                    detail: 'Files discovered'
                });
                
                // Step 3: Reading file metadata
                const step3: ThinkingStep = {
                    id: 'metadata',
                    label: 'Reading file metadata',
                    status: 'active',
                    detail: 'Extracting file types and sizes...',
                    startTime: Date.now()
                };
                addThinkingStep(step3);
                
                await new Promise(r => setTimeout(r, 400));
                updateThinkingStep('metadata', { status: 'completed', endTime: Date.now() });
                
                // Step 4: AI Analysis
                const step4: ThinkingStep = {
                    id: 'analyze',
                    label: 'AI analyzing content',
                    status: 'active',
                    detail: 'Understanding file purposes and relationships...',
                    startTime: Date.now()
                };
                addThinkingStep(step4);
                
                // Update periodically to show activity
                const analysisInterval = setInterval(() => {
                    const messages = [
                        'Generating semantic tags...',
                        'Identifying project associations...',
                        'Calculating organization suggestions...',
                        'Building category mappings...'
                    ];
                    updateThinkingStep('analyze', { 
                        detail: messages[Math.floor(Math.random() * messages.length)]
                    });
                }, 1500);
                
                // Wait for the actual API response
                const response = await fetchPromise;
                
                clearInterval(analysisInterval);
                
                // Handle AI analysis status
                if (response.ai_analysis_status === 'success') {
                    updateThinkingStep('analyze', { 
                        status: 'completed', 
                        endTime: Date.now(),
                        detail: response.ai_analysis_message || `Analyzed ${response.files.length} items`
                    });
                } else if (response.ai_analysis_status === 'failed') {
                    updateThinkingStep('analyze', { 
                        status: 'error', 
                        endTime: Date.now(),
                        detail: response.ai_analysis_message || 'AI analysis unavailable'
                    });
                } else {
                    updateThinkingStep('analyze', { 
                        status: 'completed', 
                        endTime: Date.now(),
                        detail: response.ai_analysis_message || 'Partial analysis'
                    });
                }
                
                // Step 5: Complete
                const step5: ThinkingStep = {
                    id: 'complete',
                    label: response.ai_analysis_status === 'failed' ? 'Scan completed (AI offline)' : 'Analysis complete',
                    status: 'completed',
                    detail: `Found ${response.files.length} files in ${((Date.now() - scanStartTime) / 1000).toFixed(1)}s`,
                    startTime: Date.now(),
                    endTime: Date.now()
                };
                addThinkingStep(step5);
                
                setFiles(response.files);
                
                // Show warning if AI failed but scan succeeded
                if (response.ai_analysis_status === 'failed') {
                    setError(`AI analysis: ${response.ai_analysis_message || 'Service unavailable'}`);
                }
                
                // Auto-hide thinking panel after success
                setTimeout(() => {
                    setIsThinking(false);
                }, 2000);
            } else {
                // Quick scan without AI
                const response = await fetchPromise;
                updateThinkingStep('scan', { 
                    status: 'completed', 
                    endTime: Date.now(),
                    detail: `Found ${response.files.length} items`
                });
                setFiles(response.files);
                setTimeout(() => setIsThinking(false), 1000);
            }
            
            setStep('analyze');
        } catch (err) {
            const activeStep = thinkingSteps.find(s => s.status === 'active');
            if (activeStep) {
                updateThinkingStep(activeStep.id, { 
                    status: 'error',
                    detail: err instanceof Error ? err.message : 'Failed'
                });
            }
            setError(err instanceof Error ? err.message : 'Scan failed');
            setTimeout(() => setIsThinking(false), 3000);
        } finally {
            setIsScanning(false);
            setIsAnalyzing(false);
        }
    }, [fetchApi, desktopPath, addThinkingStep, updateThinkingStep, clearThinkingSteps, thinkingSteps]);

    // Get organization proposal with thinking visualization
    const handlePropose = useCallback(async (strategyId: string) => {
        setIsProposing(true);
        setError(null);
        setSelectedStrategy(strategyId);
        setIsThinking(true);
        clearThinkingSteps();
        
        const strategyName = strategies.find(s => s.id === strategyId)?.name || strategyId;
        
        // Step 1: Starting strategy
        addThinkingStep({
            id: 'strategy-init',
            label: `Applying "${strategyName}" strategy`,
            status: 'active',
            detail: 'Evaluating file organization...',
            startTime: Date.now()
        });
        
        try {
            await new Promise(r => setTimeout(r, 300));
            updateThinkingStep('strategy-init', { status: 'completed', endTime: Date.now() });
            
            // Step 2: Calculating moves
            addThinkingStep({
                id: 'calculate',
                label: 'Calculating file moves',
                status: 'active',
                detail: 'Determining optimal folder structure...',
                startTime: Date.now()
            });
            
            const data = await fetchApi<OrganizationProposal>('/propose', {
                method: 'POST',
                body: JSON.stringify({ strategy: strategyId })
            });
            
            updateThinkingStep('calculate', { 
                status: 'completed', 
                endTime: Date.now(),
                detail: `${data.files_affected} files → ${data.estimated_folders_created} folders`
            });
            
            // Step 3: Complete
            addThinkingStep({
                id: 'proposal-done',
                label: 'Proposal ready',
                status: 'completed',
                detail: data.description,
                startTime: Date.now(),
                endTime: Date.now()
            });
            
            setCurrentProposal(data);
            setStep('preview');
            
            setTimeout(() => setIsThinking(false), 1500);
        } catch (err) {
            updateThinkingStep('calculate', { 
                status: 'error',
                detail: err instanceof Error ? err.message : 'Failed'
            });
            setError(err instanceof Error ? err.message : 'Proposal failed');
            setTimeout(() => setIsThinking(false), 3000);
        } finally {
            setIsProposing(false);
        }
    }, [fetchApi, strategies, addThinkingStep, updateThinkingStep, clearThinkingSteps]);

    // Execute proposal
    const handleExecute = useCallback(async (dryRun: boolean = false) => {
        if (!currentProposal) return;
        
        setIsExecuting(true);
        setError(null);
        
        try {
            const data = await fetchApi<ExecuteResult>('/execute', {
                method: 'POST',
                body: JSON.stringify({ 
                    proposal_id: currentProposal.id,
                    dry_run: dryRun 
                })
            });
            setExecuteResult(data);
            if (!dryRun) {
                setStep('result');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Execution failed');
        } finally {
            setIsExecuting(false);
        }
    }, [fetchApi, currentProposal]);

    // Reset to start
    const handleReset = useCallback(() => {
        setFiles([]);
        setCurrentProposal(null);
        setExecuteResult(null);
        setSelectedStrategy(null);
        setError(null);
        setStep('scan');
    }, []);

    // Group files by suggested folder for preview
    const groupedMoves = currentProposal?.moves.reduce((acc, move) => {
        const folder = move.folder || 'Uncategorized';
        if (!acc[folder]) {
            acc[folder] = [];
        }
        acc[folder].push(move);
        return acc;
    }, {} as Record<string, MoveAction[]>) || {};

    // Render step content
    const renderStepContent = () => {
        switch (step) {
            case 'scan':
                return (
                    <div className="flex flex-col items-center justify-center h-full max-w-2xl mx-auto px-6">
                        <div className="relative mb-8">
                            <div className="h-24 w-24 rounded-3xl bg-gradient-to-br from-emerald-500/20 via-teal-500/15 to-cyan-500/10 flex items-center justify-center shadow-xl">
                                <FolderOpen className="h-12 w-12 text-emerald-600 dark:text-emerald-400" />
                            </div>
                            <div className="absolute -right-2 -bottom-2 h-10 w-10 rounded-xl bg-gradient-to-br from-amber-500/30 to-orange-500/20 flex items-center justify-center">
                                <Sparkles className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                            </div>
                        </div>
                        
                        <h2 className="text-2xl font-bold mb-3 text-center">Organize Your Desktop</h2>
                        <p className="text-muted-foreground text-center mb-8 leading-relaxed">
                            Let AI analyze your desktop files and propose smart organization strategies.
                            Clean up clutter in seconds, not hours.
                        </p>
                        
                        <div className="flex flex-col sm:flex-row gap-3 w-full max-w-md">
                            <button
                                onClick={() => handleScan(true)}
                                disabled={isScanning}
                                className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-medium hover:from-emerald-700 hover:to-teal-700 transition-all shadow-lg hover:shadow-xl disabled:opacity-50"
                            >
                                {isScanning ? (
                                    <>
                                        <Loader2 className="h-5 w-5 animate-spin" />
                                        {isAnalyzing ? 'Analyzing...' : 'Scanning...'}
                                    </>
                                ) : (
                                    <>
                                        <Scan className="h-5 w-5" />
                                        Scan & Analyze
                                    </>
                                )}
                            </button>
                            <button
                                onClick={() => handleScan(false)}
                                disabled={isScanning}
                                className="flex-1 inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl border border-border bg-card text-foreground font-medium hover:bg-muted transition-all disabled:opacity-50"
                            >
                                <Scan className="h-5 w-5" />
                                Quick Scan
                            </button>
                        </div>
                        
                        <p className="text-xs text-muted-foreground mt-4">
                            Scanning: <span className="font-mono">{desktopPath}</span>
                        </p>
                    </div>
                );
            
            case 'analyze':
                return (
                    <div className="h-full flex flex-col">
                        {/* Files overview */}
                        <div className="flex items-center justify-between mb-6">
                            <div>
                                <h3 className="text-lg font-semibold">Desktop Files</h3>
                                <p className="text-sm text-muted-foreground">
                                    Found {files.length} items • Select an organization strategy
                                </p>
                            </div>
                            <button
                                onClick={handleReset}
                                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                            >
                                <RefreshCw className="h-4 w-4" />
                                Rescan
                            </button>
                        </div>
                        
                        <div className="flex-1 flex gap-6 min-h-0 overflow-hidden">
                            {/* Files List */}
                            <div className="flex-1 flex flex-col min-h-0">
                                <div className="flex-1 overflow-y-auto rounded-xl border bg-card">
                                    <div className="divide-y">
                                        {files.map((file) => (
                                            <div key={file.id} className="p-4 hover:bg-muted/50 transition-colors">
                                                <div className="flex items-start gap-3">
                                                    <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center shrink-0">
                                                        {file.is_directory ? (
                                                            <Folder className="h-5 w-5 text-amber-500" />
                                                        ) : (
                                                            <File className="h-5 w-5 text-muted-foreground" />
                                                        )}
                                                    </div>
                                                    <div className="flex-1 min-w-0">
                                                        <div className="flex items-center gap-2">
                                                            <span className="font-medium truncate">{file.name}</span>
                                                            <span className="text-xs text-muted-foreground">{file.size_display}</span>
                                                        </div>
                                                        {file.ai_summary && (
                                                            <p className="text-sm text-muted-foreground mt-1 line-clamp-2">
                                                                {file.ai_summary}
                                                            </p>
                                                        )}
                                                        <div className="flex flex-wrap gap-1.5 mt-2">
                                                            {file.tags.map((tag, idx) => (
                                                                <span
                                                                    key={idx}
                                                                    className={cn(
                                                                        "inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium",
                                                                        tag.category === 'file_type'
                                                                            ? "bg-blue-500/10 text-blue-600 dark:text-blue-400"
                                                                            : "bg-purple-500/10 text-purple-600 dark:text-purple-400"
                                                                    )}
                                                                >
                                                                    <Tag className="h-3 w-3" />
                                                                    {tag.name}
                                                                </span>
                                                            ))}
                                                            {file.suggested_folder && (
                                                                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                                                                    <ArrowRight className="h-3 w-3" />
                                                                    {file.suggested_folder}
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            </div>
                            
                            {/* Strategy Selection */}
                            <div className="w-80 flex flex-col shrink-0">
                                <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                                    <Settings2 className="h-4 w-4" />
                                    Organization Strategy
                                </h4>
                                <div className="space-y-2">
                                    {strategies.map((strategy) => {
                                        const Icon = STRATEGY_ICONS[strategy.icon] || FolderTree;
                                        const isSelected = selectedStrategy === strategy.id;
                                        return (
                                            <button
                                                key={strategy.id}
                                                onClick={() => handlePropose(strategy.id)}
                                                disabled={isProposing}
                                                className={cn(
                                                    "w-full p-4 rounded-xl border text-left transition-all",
                                                    isSelected
                                                        ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                                                        : "border-border hover:border-primary/50 hover:bg-muted/50"
                                                )}
                                            >
                                                <div className="flex items-start gap-3">
                                                    <div className={cn(
                                                        "h-10 w-10 rounded-lg flex items-center justify-center shrink-0",
                                                        isSelected ? "bg-primary/10" : "bg-muted"
                                                    )}>
                                                        {isProposing && selectedStrategy === strategy.id ? (
                                                            <Loader2 className="h-5 w-5 animate-spin text-primary" />
                                                        ) : (
                                                            <Icon className={cn(
                                                                "h-5 w-5",
                                                                isSelected ? "text-primary" : "text-muted-foreground"
                                                            )} />
                                                        )}
                                                    </div>
                                                    <div>
                                                        <span className="font-medium block">{strategy.name}</span>
                                                        <span className="text-xs text-muted-foreground">
                                                            {strategy.description}
                                                        </span>
                                                    </div>
                                                </div>
                                            </button>
                                        );
                                    })}
                                </div>
                            </div>
                        </div>
                    </div>
                );
            
            case 'preview':
                return (
                    <div className="h-full flex flex-col">
                        {/* Proposal header */}
                        <div className="flex items-center justify-between mb-6">
                            <div>
                                <h3 className="text-lg font-semibold flex items-center gap-2">
                                    <Eye className="h-5 w-5 text-primary" />
                                    Preview Changes
                                </h3>
                                <p className="text-sm text-muted-foreground">
                                    {currentProposal?.description}
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setStep('analyze')}
                                    className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                                >
                                    <Undo2 className="h-4 w-4" />
                                    Back
                                </button>
                            </div>
                        </div>
                        
                        {/* Stats */}
                        <div className="grid grid-cols-3 gap-4 mb-6">
                            <div className="p-4 rounded-xl border bg-card">
                                <div className="text-2xl font-bold text-primary">
                                    {currentProposal?.files_affected || 0}
                                </div>
                                <div className="text-sm text-muted-foreground">Files to move</div>
                            </div>
                            <div className="p-4 rounded-xl border bg-card">
                                <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400">
                                    {currentProposal?.estimated_folders_created || 0}
                                </div>
                                <div className="text-sm text-muted-foreground">Folders to create</div>
                            </div>
                            <div className="p-4 rounded-xl border bg-card">
                                <div className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                                    {Object.keys(groupedMoves).length}
                                </div>
                                <div className="text-sm text-muted-foreground">Categories</div>
                            </div>
                        </div>
                        
                        {/* Grouped moves */}
                        <div className="flex-1 overflow-y-auto rounded-xl border bg-card">
                            <div className="divide-y">
                                {Object.entries(groupedMoves).map(([folder, moves]) => (
                                    <div key={folder} className="p-4">
                                        <div className="flex items-center gap-2 mb-3">
                                            <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                                                <FolderTree className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                                            </div>
                                            <span className="font-semibold">{folder}/</span>
                                            <span className="text-sm text-muted-foreground">
                                                {moves.length} files
                                            </span>
                                        </div>
                                        <div className="ml-10 space-y-1">
                                            {moves.slice(0, 5).map((move, idx) => (
                                                <div key={idx} className="flex items-center gap-2 text-sm">
                                                    <ChevronRight className="h-3 w-3 text-muted-foreground" />
                                                    <span className="text-muted-foreground">{move.file_name}</span>
                                                </div>
                                            ))}
                                            {moves.length > 5 && (
                                                <div className="text-xs text-muted-foreground ml-5">
                                                    ...and {moves.length - 5} more files
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                        
                        {/* Actions */}
                        <div className="flex items-center justify-between pt-6 border-t mt-6">
                            <div className="text-sm text-muted-foreground">
                                {executeResult?.dry_run && (
                                    <span className="text-amber-600 dark:text-amber-400">
                                        ✓ Dry run completed successfully
                                    </span>
                                )}
                            </div>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => handleExecute(true)}
                                    disabled={isExecuting}
                                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
                                >
                                    {isExecuting ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <Eye className="h-4 w-4" />
                                    )}
                                    Dry Run
                                </button>
                                <button
                                    onClick={() => handleExecute(false)}
                                    disabled={isExecuting}
                                    className="inline-flex items-center gap-2 px-6 py-2 rounded-lg bg-gradient-to-r from-emerald-600 to-teal-600 text-white text-sm font-medium hover:from-emerald-700 hover:to-teal-700 transition-all shadow-lg disabled:opacity-50"
                                >
                                    {isExecuting ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <Play className="h-4 w-4" />
                                    )}
                                    Execute
                                </button>
                            </div>
                        </div>
                    </div>
                );
            
            case 'result':
                return (
                    <div className="flex flex-col items-center justify-center h-full max-w-2xl mx-auto px-6">
                        {executeResult?.success ? (
                            <>
                                <div className="h-20 w-20 rounded-full bg-gradient-to-br from-emerald-500/20 to-teal-500/10 flex items-center justify-center mb-6">
                                    <Check className="h-10 w-10 text-emerald-600 dark:text-emerald-400" />
                                </div>
                                <h2 className="text-2xl font-bold mb-3">Organization Complete!</h2>
                                <p className="text-muted-foreground text-center mb-6">
                                    Successfully moved {executeResult.moved.length} files into {executeResult.folders_created.length} folders.
                                </p>
                                
                                {executeResult.failed.length > 0 && (
                                    <div className="w-full max-w-md p-4 rounded-xl bg-destructive/10 border border-destructive/20 mb-6">
                                        <div className="flex items-center gap-2 text-destructive font-medium mb-2">
                                            <AlertCircle className="h-4 w-4" />
                                            {executeResult.failed.length} files could not be moved
                                        </div>
                                        <div className="space-y-1">
                                            {executeResult.failed.slice(0, 3).map((f, idx) => (
                                                <div key={idx} className="text-sm text-muted-foreground">
                                                    {f.file}: {f.error}
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </>
                        ) : (
                            <>
                                <div className="h-20 w-20 rounded-full bg-destructive/10 flex items-center justify-center mb-6">
                                    <X className="h-10 w-10 text-destructive" />
                                </div>
                                <h2 className="text-2xl font-bold mb-3">Organization Failed</h2>
                                <p className="text-muted-foreground text-center mb-6">
                                    There was an error during the organization process.
                                </p>
                            </>
                        )}
                        
                        <button
                            onClick={handleReset}
                            className="inline-flex items-center gap-2 px-6 py-3 rounded-xl bg-gradient-to-r from-emerald-600 to-teal-600 text-white font-medium hover:from-emerald-700 hover:to-teal-700 transition-all shadow-lg"
                        >
                            <RefreshCw className="h-5 w-5" />
                            Start Over
                        </button>
                    </div>
                );
            
            default:
                return null;
        }
    };

    return (
        <div className="h-full flex flex-col bg-gradient-to-br from-background via-background to-emerald-500/5">
            {/* Header */}
            <div className="flex-none border-b border-border/50 bg-card/30 backdrop-blur-sm px-6 pt-8 pb-6" style={dragStyle}>
                <div className="flex items-center gap-4" style={noDragStyle}>
                    <div className="h-12 w-12 rounded-2xl bg-gradient-to-br from-emerald-500/20 to-teal-500/10 flex items-center justify-center shadow-lg">
                        <FolderTree className="h-6 w-6 text-emerald-600 dark:text-emerald-400" />
                    </div>
                    <div>
                        <div className="flex items-center gap-2">
                            <h1 className="text-2xl font-bold tracking-tight select-text">Desktop Organizer</h1>
                            <span className="relative group cursor-help">
                                <span className="px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider rounded-full bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-500/30">
                                    Test Mode
                                </span>
                                <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-2 px-3 py-2 text-xs font-normal normal-case tracking-normal text-white bg-gray-900 dark:bg-gray-800 rounded-lg shadow-lg opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200 whitespace-nowrap z-50">
                                    Feature in development, may have issues
                                    <span className="absolute left-1/2 -translate-x-1/2 -top-1 w-2 h-2 bg-gray-900 dark:bg-gray-800 rotate-45" />
                                </span>
                            </span>
                        </div>
                        <p className="text-sm text-muted-foreground select-text">
                            AI-powered file organization
                        </p>
                    </div>
                </div>
                
                {/* Progress steps */}
                {step !== 'scan' && (
                    <div className="flex items-center gap-2 mt-6" style={noDragStyle}>
                        {['scan', 'analyze', 'strategy', 'preview', 'result'].map((s, idx) => {
                            const stepIdx = ['scan', 'analyze', 'strategy', 'preview', 'result'].indexOf(step);
                            const isActive = s === step;
                            const isPast = idx < stepIdx;
                            
                            // Only show relevant steps
                            if (s === 'strategy') return null;
                            
                            return (
                                <div key={s} className="flex items-center gap-2">
                                    <div className={cn(
                                        "h-2 w-2 rounded-full transition-colors",
                                        isActive ? "bg-primary" : isPast ? "bg-primary/50" : "bg-muted"
                                    )} />
                                    {idx < 4 && <div className={cn(
                                        "w-8 h-0.5 transition-colors",
                                        isPast ? "bg-primary/50" : "bg-muted"
                                    )} />}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
            
            {/* Error banner */}
            {error && (
                <div className="mx-6 mt-4 p-4 rounded-xl bg-destructive/10 border border-destructive/20 flex items-center gap-3">
                    <AlertCircle className="h-5 w-5 text-destructive shrink-0" />
                    <span className="text-sm text-destructive">{error}</span>
                    <button
                        onClick={() => setError(null)}
                        className="ml-auto text-destructive hover:text-destructive/80"
                    >
                        <X className="h-4 w-4" />
                    </button>
                </div>
            )}
            
            {/* Content */}
            <div className="flex-1 overflow-hidden p-6">
                {renderStepContent()}
            </div>
            
            {/* Agent Thinking Panel */}
            <ThinkingPanel steps={thinkingSteps} isActive={isThinking} />
        </div>
    );
}

