import { useState, useEffect } from 'react';
import { Check, Loader2, ChevronDown, ChevronUp, FileText, XCircle, RotateCcw } from 'lucide-react';
import type { MbtiProgress, MbtiResult, MbtiDimensionProgress, FilterProgress, EmbedProgress } from '../hooks/useMbtiAnalysis';
import type { IndexedFile } from '../types';

interface MbtiAnalysisProps {
    isAnalyzing: boolean;
    isGeneratingReport: boolean;
    progress: MbtiProgress;
    result: MbtiResult | null;
    error: string | null;
    filterProgress: FilterProgress;
    embedProgress: EmbedProgress;
    onStartAnalysis: (files: IndexedFile[]) => Promise<void>;
    onStartAnalysisWithFilter: () => Promise<void>;
    onStopAnalysis: () => void;
    onResetAnalysis: () => void;
    setProgress: React.Dispatch<React.SetStateAction<MbtiProgress>>;
    files: IndexedFile[];
}

// MbtiResult is now imported from useMbtiAnalysis hook

export function MbtiAnalysis({
    isAnalyzing,
    isGeneratingReport,
    progress,
    result,
    error,
    filterProgress,
    embedProgress,
    onStartAnalysis,
    onStartAnalysisWithFilter,
    onStopAnalysis,
    onResetAnalysis,
    setProgress,
    files
}: MbtiAnalysisProps) {
    // Only keep UI state (expandedDimensions) locally
    const [expandedDimensions, setExpandedDimensions] = useState<Record<string, boolean>>({
        'E-I': true,
        'S-N': true,
        'T-F': true,
        'J-P': true
    });

    // Load/save expanded state from localStorage
    useEffect(() => {
        try {
            const savedExpanded = localStorage.getItem('mbti-analysis-expanded');
            if (savedExpanded) {
                setExpandedDimensions(JSON.parse(savedExpanded));
            }
        } catch (error) {
            console.error('Failed to load saved expanded state:', error);
        }
    }, []);

    useEffect(() => {
        localStorage.setItem('mbti-analysis-expanded', JSON.stringify(expandedDimensions));
    }, [expandedDimensions]);

    const handleStartAnalysis = async () => {
        await onStartAnalysisWithFilter();
    };

    const getDimensionName = (key: string) => {
        const names: Record<string, string> = {
            'E-I': 'Energy (E-I)',
            'S-N': 'Information (S-N)',
            'T-F': 'Decisions (T-F)',
            'J-P': 'Structure (J-P)'
        };
        return names[key] || key;
    };

    const getTendencyName = (dimension: string, tendency: string) => {
        const tendencies: Record<string, Record<string, string>> = {
            'E-I': { 'E': 'Extraverted', 'I': 'Introverted' },
            'S-N': { 'S': 'Sensing', 'N': 'Intuitive' },
            'T-F': { 'T': 'Thinking', 'F': 'Feeling' },
            'J-P': { 'J': 'Judging', 'P': 'Perceiving' }
        };
        return tendencies[dimension]?.[tendency] || tendency;
    };

    const getCurrentAnalysisStatus = () => {
        // Find the currently analyzing dimension and file
        const dimensions = ['E-I', 'S-N', 'T-F', 'J-P'] as const;

        for (const dim of dimensions) {
            const dimProgress = progress[dim];
            if (dimProgress.status === 'analyzing' && dimProgress.currentFile) {
                return {
                    dimension: dim,
                    dimensionName: getDimensionName(dim),
                    file: dimProgress.currentFile
                };
            }
        }

        // If no specific file, find which dimension is analyzing
        for (const dim of dimensions) {
            if (progress[dim].status === 'analyzing') {
                return {
                    dimension: dim,
                    dimensionName: getDimensionName(dim),
                    file: null
                };
            }
        }

        return null;
    };

    return (
        <div className="flex h-full flex-col bg-background">
            {/* Header */}
            <div className="border-b px-6 py-4">
                <div className="flex items-center justify-between">
                    <div className="flex-1">
                        <div className="flex items-center gap-2">
                            <h1 className="text-xl font-semibold text-foreground select-text">
                                {isAnalyzing ? 'Analyzing...' : 'MBTI Analysis'}
                            </h1>
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
                        <p className="mt-1 text-sm text-muted-foreground select-text">
                            {isAnalyzing
                                ? 'Processing your files to determine personality type'
                                : 'Analyze your personality type based on your uploaded files'}
                        </p>
                    </div>

                    {/* Stop & Restart Button */}
                    {(isAnalyzing || filterProgress.status !== 'idle' || embedProgress.status !== 'idle') && !result && (
                        <button
                            onClick={() => {
                                onStopAnalysis();
                                onResetAnalysis();
                            }}
                            className="flex items-center gap-2 rounded-lg border border-red-300 dark:border-red-800 bg-background px-4 py-2 text-sm font-medium text-red-600 dark:text-red-400 transition-colors hover:bg-red-50 dark:hover:bg-red-900/20"
                        >
                            <XCircle className="h-4 w-4" />
                            Stop & Restart
                        </button>
                    )}
                </div>

                {/* Real-time Analysis Status Indicator */}
                {isAnalyzing && !isGeneratingReport && (() => {
                    const status = getCurrentAnalysisStatus();
                    if (status) {
                        return (
                            <div className="mt-3 flex items-center gap-3 rounded-lg bg-slate-50 dark:bg-slate-900 px-4 py-3 border border-slate-200 dark:border-slate-700">
                                <div className="relative flex h-2 w-2">
                                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                                    <span className="relative inline-flex rounded-full h-2 w-2 bg-blue-500"></span>
                                </div>
                                <div className="flex-1 text-sm">
                                    {status.file ? (
                                        <span className="text-foreground">
                                            Local Cocoa is helping you analyze <span className="font-semibold text-blue-600 dark:text-blue-400">{status.dimensionName}</span> dimension: <span className="font-medium italic">{status.file}</span>
                                        </span>
                                    ) : (
                                        <span className="text-foreground">
                                            Local Cocoa is helping you process <span className="font-semibold text-blue-600 dark:text-blue-400">{status.dimensionName}</span> dimension...
                                        </span>
                                    )}
                                </div>
                                <Loader2 className="h-4 w-4 animate-spin text-blue-500" />
                            </div>
                        );
                    }
                    return null;
                })()}
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-y-auto p-6">
                {/* Filter and Embed Progress */}
                {(filterProgress.status !== 'idle' || embedProgress.status !== 'idle') && !isAnalyzing && (
                    <div className="mx-auto max-w-2xl space-y-6">
                        {/* Filter Progress */}
                        <div className="rounded-lg border bg-card p-6 shadow">
                            <div className="flex items-center gap-3 mb-4">
                                {filterProgress.status === 'scanning' && (
                                    <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                                )}
                                {filterProgress.status === 'complete' && (
                                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-green-600">
                                        <Check className="h-4 w-4 text-white" />
                                    </div>
                                )}
                                {filterProgress.status === 'error' && (
                                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-red-600">
                                        <XCircle className="h-4 w-4 text-white" />
                                    </div>
                                )}
                                <h3 className="text-lg font-semibold text-foreground">
                                    Step 1: Filtering Files
                                </h3>
                            </div>
                            {filterProgress.message && (
                                <p className="text-sm text-muted-foreground">
                                    {filterProgress.message}
                                    {filterProgress.filesCount !== undefined && ` (${filterProgress.filesCount} files)`}
                                </p>
                            )}
                        </div>

                        {/* Embed Progress */}
                        {filterProgress.status === 'complete' && (
                            <div className="rounded-lg border bg-card p-6 shadow">
                                <div className="flex items-center gap-3 mb-4">
                                    {embedProgress.status === 'embedding' && (
                                        <Loader2 className="h-5 w-5 animate-spin text-blue-500" />
                                    )}
                                    {embedProgress.status === 'complete' && (
                                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-green-600">
                                            <Check className="h-4 w-4 text-white" />
                                        </div>
                                    )}
                                    {embedProgress.status === 'error' && (
                                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-red-600">
                                            <XCircle className="h-4 w-4 text-white" />
                                        </div>
                                    )}
                                    <h3 className="text-lg font-semibold text-foreground">
                                        Step 2: Embedding Files
                                    </h3>
                                </div>
                                {embedProgress.current !== undefined && embedProgress.total !== undefined && (
                                    <div className="space-y-2">
                                        <p className="text-sm text-muted-foreground">
                                            {embedProgress.currentFile ? `Processing: ${embedProgress.currentFile}` : 'Preparing files...'}
                                        </p>
                                        <div className="flex items-center gap-2">
                                            <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-blue-500 transition-all duration-300"
                                                    style={{ width: `${(embedProgress.current / embedProgress.total) * 100}%` }}
                                                />
                                            </div>
                                            <span className="text-sm text-muted-foreground">
                                                {embedProgress.current}/{embedProgress.total}
                                            </span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* Initial State */}
                {!isAnalyzing && !result && filterProgress.status === 'idle' && (
                    <div className="flex h-full items-center justify-center">
                        <div className="flex flex-col items-center space-y-6">
                            <div className="flex h-24 w-24 items-center justify-center rounded-full bg-gradient-to-br from-primary/80 to-primary shadow-xl">
                                <svg className="h-12 w-12 text-primary-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                                </svg>
                            </div>
                            <div className="text-center">
                                <h2 className="text-2xl font-semibold text-foreground">Discover Your Personality Type</h2>
                                <p className="mt-2 max-w-md text-sm text-muted-foreground">
                                    AI will analyze your files to determine your MBTI personality type
                                </p>
                            </div>
                            <button
                                onClick={handleStartAnalysis}
                                className="rounded-lg bg-gradient-to-r from-primary to-primary/80 px-10 py-4 font-semibold text-primary-foreground shadow-lg transition-all hover:shadow-xl hover:from-primary/90 hover:to-primary/70 active:scale-95"
                            >
                                Start Analysis
                            </button>
                        </div>
                    </div>
                )}

                {/* Analyzing State - 4 Dimension Progress Areas */}
                {isAnalyzing && !isGeneratingReport && (
                    <div className="mx-auto max-w-5xl space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                            {(['E-I', 'S-N', 'T-F', 'J-P'] as const).map((dimension) => {
                                const dimProgress = progress[dimension];
                                const isExpanded = expandedDimensions[dimension];

                                return (
                                    <div key={dimension} className="rounded-lg border bg-card shadow">
                                        {/* Header */}
                                        <div className="p-4 border-b">
                                            <div className="flex items-center justify-between">
                                                <h3 className="font-semibold text-foreground">{getDimensionName(dimension)}</h3>
                                                <div className="flex items-center gap-2">
                                                    {dimProgress.status === 'complete' && (
                                                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-green-600">
                                                            <Check className="h-4 w-4 text-white" />
                                                        </div>
                                                    )}
                                                    {dimProgress.status === 'analyzing' && (
                                                        <Loader2 className="h-5 w-5 animate-spin text-slate-500" />
                                                    )}
                                                    {/* Always show expand/collapse button when there's content OR when analyzing */}
                                                    {(dimProgress.status === 'analyzing' || (dimProgress.status === 'complete' && dimProgress.analysisContent)) && (
                                                        <button
                                                            onClick={() => setExpandedDimensions(prev => ({
                                                                ...prev,
                                                                [dimension]: !prev[dimension]
                                                            }))}
                                                            className="text-muted-foreground hover:text-foreground transition-colors"
                                                        >
                                                            {isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>

                                        {/* Content */}
                                        <div className="p-4">
                                            {dimProgress.status === 'pending' && (
                                                <p className="text-sm text-muted-foreground">Waiting...</p>
                                            )}

                                            {dimProgress.status === 'analyzing' && (
                                                <div className="space-y-3">
                                                    {/* Current File */}
                                                    {dimProgress.currentFile && (
                                                        <div className="flex items-center gap-2 text-sm">
                                                            <FileText className="h-4 w-4 text-slate-500" />
                                                            <span className="text-foreground font-medium truncate">
                                                                {dimProgress.currentFile}
                                                            </span>
                                                        </div>
                                                    )}

                                                    {/* Current Step */}
                                                    {dimProgress.currentStep && (
                                                        <div className="text-sm text-muted-foreground italic">
                                                            {dimProgress.currentStep}
                                                        </div>
                                                    )}

                                                    {/* Real-time Analysis Content (Like ChatGPT Thinking) */}
                                                    {isExpanded && dimProgress.analysisContent && (
                                                        <div className="mt-2 p-3 rounded-md bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 max-h-64 overflow-y-auto">
                                                            <div className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
                                                                {dimProgress.analysisContent}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* Processed Files Count */}
                                                    {dimProgress.processedFiles && dimProgress.processedFiles.length > 0 && (
                                                        <div className="text-xs text-muted-foreground">
                                                            Processed {dimProgress.processedFiles.length} file{dimProgress.processedFiles.length !== 1 ? 's' : ''}
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {dimProgress.status === 'complete' && (
                                                <div className="space-y-3">
                                                    <div className="space-y-1 text-sm">
                                                        <p className="text-green-600 font-medium flex items-center gap-1">
                                                            <Check className="h-4 w-4" /> Analysis complete
                                                        </p>
                                                        <p className="text-muted-foreground">Files: {dimProgress.filesAnalyzed}</p>
                                                        <p className="text-muted-foreground">Evidence: {dimProgress.evidenceCount}</p>
                                                    </div>

                                                    {/* Show final analysis content if available */}
                                                    {isExpanded && dimProgress.analysisContent && (
                                                        <div className="mt-2 p-3 rounded-md bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 max-h-64 overflow-y-auto">
                                                            <div className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed">
                                                                {dimProgress.analysisContent}
                                                            </div>
                                                        </div>
                                                    )}
                                                </div>
                                            )}

                                            {dimProgress.status === 'error' && (
                                                <p className="text-sm text-red-400">Error: {dimProgress.error}</p>
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* Generating Report State */}
                {isGeneratingReport && (
                    <div className="flex h-full items-center justify-center">
                        <div className="text-center">
                            <Loader2 className="mx-auto h-12 w-12 animate-spin text-slate-500" />
                            <p className="mt-4 text-lg font-medium text-foreground">Generating Final Report...</p>
                            <p className="mt-2 text-sm text-muted-foreground">Synthesizing all evidence</p>
                        </div>
                    </div>
                )}

                {/* Results Display */}
                {result && !isAnalyzing && (
                    <div className="mx-auto max-w-4xl space-y-8">
                        {/* MBTI Type - Center */}
                        <div className="flex flex-col items-center space-y-4 py-8">
                            <div className="flex h-32 w-32 items-center justify-center rounded-full bg-gradient-to-br from-primary/80 to-primary shadow-2xl">
                                <span className="text-5xl font-bold text-primary-foreground">{result.mbti_type}</span>
                            </div>
                            <h2 className="text-3xl font-bold text-foreground">{result.mbti_type} Personality</h2>
                            <p className="max-w-2xl text-center text-muted-foreground">{result.summary}</p>
                            <div className="flex gap-4 text-sm text-muted-foreground">
                                <span>Files Analyzed: {result.files_analyzed}</span>
                            </div>
                        </div>

                        {/* Dimension Evidence - Scrollable */}
                        <div className="space-y-6">
                            <h3 className="text-xl font-semibold text-foreground">Evidence by Dimension</h3>

                            {/* E-I */}
                            <div className="rounded-xl border bg-card p-6 shadow">
                                <div className="mb-4 flex items-center justify-between">
                                    <h4 className="text-lg font-semibold text-foreground">Energy (E-I)</h4>
                                    <span className="rounded-full bg-primary px-4 py-1 text-sm font-medium text-primary-foreground">
                                        {getTendencyName('E-I', result.dimension_scores['E-I'].tendency)}
                                    </span>
                                </div>
                                <ul className="space-y-2">
                                    {result.detailed_evidence['E-I'].flatMap(item =>
                                        item.evidence.map((ev, idx) => (
                                            <li key={`${item.file}-${idx}`} className="flex items-start gap-2 text-sm text-muted-foreground">
                                                <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-slate-500" />
                                                <span>{ev}</span>
                                            </li>
                                        ))
                                    )}
                                </ul>
                            </div>

                            {/* S-N */}
                            <div className="rounded-xl border bg-card p-6 shadow">
                                <div className="mb-4 flex items-center justify-between">
                                    <h4 className="text-lg font-semibold text-foreground">Information (S-N)</h4>
                                    <span className="rounded-full bg-primary px-4 py-1 text-sm font-medium text-primary-foreground">
                                        {getTendencyName('S-N', result.dimension_scores['S-N'].tendency)}
                                    </span>
                                </div>
                                <ul className="space-y-2">
                                    {result.detailed_evidence['S-N'].flatMap(item =>
                                        item.evidence.map((ev, idx) => (
                                            <li key={`${item.file}-${idx}`} className="flex items-start gap-2 text-sm text-muted-foreground">
                                                <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-slate-500" />
                                                <span>{ev}</span>
                                            </li>
                                        ))
                                    )}
                                </ul>
                            </div>

                            {/* T-F */}
                            <div className="rounded-xl border bg-card p-6 shadow">
                                <div className="mb-4 flex items-center justify-between">
                                    <h4 className="text-lg font-semibold text-foreground">Decisions (T-F)</h4>
                                    <span className="rounded-full bg-primary px-4 py-1 text-sm font-medium text-primary-foreground">
                                        {getTendencyName('T-F', result.dimension_scores['T-F'].tendency)}
                                    </span>
                                </div>
                                <ul className="space-y-2">
                                    {result.detailed_evidence['T-F'].flatMap(item =>
                                        item.evidence.map((ev, idx) => (
                                            <li key={`${item.file}-${idx}`} className="flex items-start gap-2 text-sm text-muted-foreground">
                                                <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-slate-500" />
                                                <span>{ev}</span>
                                            </li>
                                        ))
                                    )}
                                </ul>
                            </div>

                            {/* J-P */}
                            <div className="rounded-xl border bg-card p-6 shadow">
                                <div className="mb-4 flex items-center justify-between">
                                    <h4 className="text-lg font-semibold text-foreground">Structure (J-P)</h4>
                                    <span className="rounded-full bg-primary px-4 py-1 text-sm font-medium text-primary-foreground">
                                        {getTendencyName('J-P', result.dimension_scores['J-P'].tendency)}
                                    </span>
                                </div>
                                <ul className="space-y-2">
                                    {result.detailed_evidence['J-P'].flatMap(item =>
                                        item.evidence.map((ev, idx) => (
                                            <li key={`${item.file}-${idx}`} className="flex items-start gap-2 text-sm text-muted-foreground">
                                                <span className="mt-1 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-slate-500" />
                                                <span>{ev}</span>
                                            </li>
                                        ))
                                    )}
                                </ul>
                            </div>
                        </div>

                        {/* Action Buttons */}
                        <div className="flex justify-center gap-4 pb-8">
                            <button
                                onClick={() => {
                                    onResetAnalysis();
                                    // Clear localStorage when starting over
                                    localStorage.removeItem('mbti-analysis-result');
                                    localStorage.removeItem('mbti-is-analyzing');
                                    localStorage.removeItem('mbti-analysis-progress');
                                }}
                                className="flex items-center gap-2 rounded-lg border bg-background px-6 py-2 text-sm font-medium transition-colors hover:bg-accent"
                            >
                                <RotateCcw className="h-4 w-4" />
                                Analyze Again
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
