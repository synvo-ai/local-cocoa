import { useState, useCallback, useRef } from 'react';
import type { IndexedFile } from '../types';

export interface MbtiDimensionProgress {
    status: 'waiting' | 'analyzing' | 'complete' | 'error';
    currentFile?: string;
    currentStep?: string;
    analysisContent?: string;
    processedFiles: string[];
    filesAnalyzed?: number;
    evidenceCount?: number;
    error?: string;
}

export interface MbtiProgress {
    'E-I': MbtiDimensionProgress;
    'S-N': MbtiDimensionProgress;
    'T-F': MbtiDimensionProgress;
    'J-P': MbtiDimensionProgress;
}

export interface FilterProgress {
    status: 'idle' | 'scanning' | 'complete' | 'error';
    message?: string;
    filesCount?: number;
}

export interface EmbedProgress {
    status: 'idle' | 'embedding' | 'complete' | 'error';
    current?: number;
    total?: number;
    currentFile?: string;
}

interface DimensionScore {
    tendency: string;
    evidence_count: number;
    files_analyzed: number;
}

interface EvidenceItem {
    file: string;
    category: string;
    evidence: string[];
}

export interface MbtiResult {
    mbti_type: string;
    analysis_timestamp: string;
    files_analyzed: number;
    dimension_scores: {
        'E-I': DimensionScore;
        'S-N': DimensionScore;
        'T-F': DimensionScore;
        'J-P': DimensionScore;
    };
    summary: string;
    detailed_evidence: {
        'E-I': EvidenceItem[];
        'S-N': EvidenceItem[];
        'T-F': EvidenceItem[];
        'J-P': EvidenceItem[];
    };
}

const initialProgress: MbtiProgress = {
    'E-I': { status: 'waiting', processedFiles: [] },
    'S-N': { status: 'waiting', processedFiles: [] },
    'T-F': { status: 'waiting', processedFiles: [] },
    'J-P': { status: 'waiting', processedFiles: [] }
};

export function useMbtiAnalysis() {
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isGeneratingReport, setIsGeneratingReport] = useState(false);
    const [progress, setProgress] = useState<MbtiProgress>(initialProgress);
    const [result, setResult] = useState<MbtiResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [filterProgress, setFilterProgress] = useState<FilterProgress>({ status: 'idle' });
    const [embedProgress, setEmbedProgress] = useState<EmbedProgress>({ status: 'idle' });
    const abortControllerRef = useRef<AbortController | null>(null);

    // Start analysis with filter only (no embedding)
    const startAnalysisWithFilter = useCallback(async () => {
        try {
            // Reset all states
            setFilterProgress({ status: 'idle' });
            setEmbedProgress({ status: 'idle' });
            setIsAnalyzing(false);
            setResult(null);
            setError(null);
            setIsGeneratingReport(false);
            setProgress(initialProgress);

            // Create abort controller
            const controller = new AbortController();
            abortControllerRef.current = controller;

            // Step 1: Filter files from E drive
            console.log('Step 1: Filtering files from E drive...');
            setFilterProgress({ status: 'scanning', message: 'Scanning E drive for personal files...' });

            // Get API key
            const apiKey = await (window as any).api?.getLocalKey();
            if (!apiKey) {
                throw new Error('API key not found. Please restart the application.');
            }

            const filterResponse = await fetch('http://127.0.0.1:8890/mbti/filter/stream', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': apiKey
                },
                signal: controller.signal
            });

            if (!filterResponse.ok) {
                throw new Error(`Failed to start filtering: ${filterResponse.status}`);
            }

            const filterReader = filterResponse.body?.getReader();
            const decoder = new TextDecoder();

            if (!filterReader) {
                throw new Error('Filter response body is not readable');
            }

            let buffer = '';
            let filteredFiles: any[] = [];

            while (true) {
                const { done, value } = await filterReader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim() || !line.startsWith('data: ')) continue;

                    try {
                        const jsonStr = line.substring(6);
                        const event = JSON.parse(jsonStr);

                        if (event.type === 'scan_complete') {
                            setFilterProgress({
                                status: 'complete',
                                filesCount: event.files_count,
                                message: event.message
                            });
                        } else if (event.type === 'files_ready') {
                            filteredFiles = event.files;
                        } else if (event.type === 'error') {
                            throw new Error(event.message);
                        }
                    } catch (e) {
                        console.error('Failed to parse filter event:', e);
                    }
                }
            }

            if (filteredFiles.length === 0) {
                throw new Error('No suitable files found for MBTI analysis');
            }

            console.log(`Found ${filteredFiles.length} files:`, filteredFiles);

            // Step 2: Index files (create temp folders and index)
            console.log('Step 2: Indexing files...');
            setEmbedProgress({ status: 'embedding', current: 0, total: filteredFiles.length, currentFile: 'Creating temporary folders...' });

            const indexResponse = await fetch('http://127.0.0.1:8890/mbti/index/stream', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': apiKey
                },
                body: JSON.stringify({ files: filteredFiles }),
                signal: controller.signal
            });

            if (!indexResponse.ok) {
                throw new Error(`Failed to start indexing: ${indexResponse.status}`);
            }

            const indexReader = indexResponse.body?.getReader();
            if (!indexReader) {
                throw new Error('Index response body is not readable');
            }

            let indexBuffer = '';
            let tempDirs: string[] = [];

            while (true) {
                const { done, value } = await indexReader.read();
                if (done) break;

                indexBuffer += decoder.decode(value, { stream: true });
                const lines = indexBuffer.split('\n');
                indexBuffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim() || !line.startsWith('data: ')) continue;

                    try {
                        const jsonStr = line.substring(6);
                        const event = JSON.parse(jsonStr);

                        if (event.type === 'create_temp_start') {
                            setEmbedProgress({ status: 'embedding', current: 0, total: filteredFiles.length, currentFile: 'Creating temporary folders...' });
                        } else if (event.type === 'create_temp_complete') {
                            tempDirs = event.temp_dirs || [];
                            setEmbedProgress({ status: 'embedding', current: 1, total: 3, currentFile: 'Temporary folders created' });
                        } else if (event.type === 'index_start') {
                            setEmbedProgress({ status: 'embedding', current: 2, total: 3, currentFile: 'Indexing files...' });
                        } else if (event.type === 'index_complete') {
                            setEmbedProgress({ status: 'complete', current: 3, total: 3, currentFile: 'Indexing completed' });
                        } else if (event.type === 'error') {
                            throw new Error(event.message);
                        }
                    } catch (e) {
                        console.error('Failed to parse index event:', e);
                    }
                }
            }

            // Step 3: Start MBTI analysis
            console.log('Step 3: Starting MBTI analysis...');
            await startAnalysis(filteredFiles);

            // Step 4: Cleanup temp folders
            console.log('Step 4: Cleaning up temporary folders...');
            try {
                await fetch('http://127.0.0.1:8890/mbti/cleanup', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'X-API-Key': apiKey
                    },
                    body: JSON.stringify({ temp_dirs: tempDirs })
                });
                console.log('Cleanup completed');
            } catch (cleanupError) {
                console.error('Cleanup failed (non-critical):', cleanupError);
            }

        } catch (error) {
            if ((error as any).name === 'AbortError') {
                console.log('MBTI workflow was aborted');
            } else {
                console.error('Failed to start MBTI analysis:', error);
                const errorMsg = error instanceof Error ? error.message : 'Unknown error';
                setFilterProgress({ status: 'error', message: errorMsg });
                setError(errorMsg);
            }
        }
    }, []);

    const startAnalysis = useCallback(async (files: any[]) => {
        // Reset states
        setIsAnalyzing(true);
        setResult(null);
        setError(null);
        setIsGeneratingReport(false);
        setProgress(initialProgress);

        // Create abort controller
        const controller = new AbortController();
        abortControllerRef.current = controller;

        try {
            // Get API key
            const apiKey = await (window as any).api?.getLocalKey();
            if (!apiKey) {
                throw new Error('API key not found. Please restart the application.');
            }

            const response = await fetch('http://127.0.0.1:8890/mbti/analyze/stream', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': apiKey
                },
                body: JSON.stringify({ files }),
                signal: controller.signal
            });

            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const reader = response.body?.getReader();
            const decoder = new TextDecoder();

            if (!reader) {
                throw new Error('Response body is not readable');
            }

            let buffer = '';

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const lines = buffer.split('\n');
                buffer = lines.pop() || '';

                for (const line of lines) {
                    if (!line.trim() || !line.startsWith('data: ')) continue;

                    try {
                        const jsonStr = line.substring(6);
                        const event = JSON.parse(jsonStr);

                        if (event.type === 'dimension_start') {
                            setProgress(prev => ({
                                ...prev,
                                [event.dimension]: {
                                    status: 'analyzing',
                                    processedFiles: [],
                                    currentStep: `Starting ${event.dimension} analysis...`
                                }
                            }));
                        } else if (event.type === 'file_start') {
                            setProgress(prev => ({
                                ...prev,
                                [event.dimension]: {
                                    ...prev[event.dimension],
                                    status: 'analyzing',
                                    currentFile: event.file,
                                    currentStep: `Analyzing ${event.file}...`
                                }
                            }));
                        } else if (event.type === 'file_complete') {
                            const currentProgress = progress[event.dimension as keyof MbtiProgress];
                            const processedFiles = currentProgress.processedFiles || [];

                            setProgress(prev => ({
                                ...prev,
                                [event.dimension]: {
                                    ...prev[event.dimension],
                                    status: 'analyzing',
                                    currentFile: undefined,
                                    currentStep: `鉁?Completed: ${event.file}`,
                                    analysisContent: event.analysis_content || prev[event.dimension].analysisContent,
                                    processedFiles: [...processedFiles, event.file]
                                }
                            }));
                        } else if (event.type === 'dimension_complete') {
                            setProgress(prev => ({
                                ...prev,
                                [event.dimension]: {
                                    ...prev[event.dimension],
                                    status: 'complete',
                                    currentStep: `Completed ${event.dimension} analysis`,
                                    filesAnalyzed: event.files_analyzed,
                                    evidenceCount: event.evidence_count,
                                    currentFile: undefined
                                }
                            }));
                        } else if (event.type === 'dimension_error') {
                            setProgress(prev => ({
                                ...prev,
                                [event.dimension]: {
                                    ...prev[event.dimension],
                                    status: 'error',
                                    currentStep: `Error: ${event.error}`,
                                    error: event.error,
                                    processedFiles: []
                                }
                            }));
                        } else if (event.type === 'report_start') {
                            setIsGeneratingReport(true);
                        } else if (event.type === 'report_complete') {
                            setResult(event.report);
                            setIsGeneratingReport(false);
                            setIsAnalyzing(false);
                        } else if (event.type === 'error') {
                            setError(event.message);
                            setIsAnalyzing(false);
                            setIsGeneratingReport(false);
                        }
                    } catch (e) {
                        console.error('Failed to parse SSE event:', e, 'Line:', line);
                    }
                }
            }
        } catch (err: any) {
            if (err.name === 'AbortError') {
                console.log('MBTI analysis was aborted');
            } else {
                console.error('MBTI analysis error:', err);
                setError(err.message || 'Failed to analyze files');
                setIsAnalyzing(false);
                setIsGeneratingReport(false);
            }
        }
    }, [progress]);

    const stopAnalysis = useCallback(() => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }
        setIsAnalyzing(false);
        setIsGeneratingReport(false);
    }, []);

    const resetAnalysis = useCallback(async () => {
        // Abort ongoing operations
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
            abortControllerRef.current = null;
        }

        // Reset all states
        setIsAnalyzing(false);
        setIsGeneratingReport(false);
        setProgress(initialProgress);
        setResult(null);
        setError(null);
        setFilterProgress({ status: 'idle' });
        setEmbedProgress({ status: 'idle' });
    }, []);

    return {
        isAnalyzing,
        isGeneratingReport,
        progress,
        result,
        error,
        filterProgress,
        embedProgress,
        startAnalysis,
        startAnalysisWithFilter,
        stopAnalysis,
        resetAnalysis,
        setProgress
    };
}
