/**
 * Email Plugin Types
 * Sources: plugins/mail/frontend/types/index.ts
 */

export type EmailProtocol = 'imap' | 'pop3' | 'outlook';

export interface EmailAccountPayload {
    label: string;
    protocol: EmailProtocol;
    host?: string;
    port?: number;
    username?: string;
    password?: string;
    useSsl?: boolean;
    folder?: string;
    // Outlook
    clientId?: string;
    tenantId?: string;
}

export interface EmailAccountSummary {
    id: string;
    label: string;
    protocol: EmailProtocol;
    host?: string;
    port: number;
    username?: string;
    useSsl: boolean;
    folder?: string | null;
    enabled: boolean;
    createdAt: string;
    updatedAt: string;
    lastSyncedAt?: string | null;
    lastSyncStatus?: string | null;
    totalMessages: number;
    recentNewMessages: number;
    folderId: string;
    folderPath: string;
    // Outlook
    clientId?: string;
    tenantId?: string;
}

export interface EmailSyncResult {
    accountId: string;
    folderId: string;
    folderPath: string;
    newMessages: number;
    totalMessages: number;
    indexed: number;
    lastSyncedAt: string;
    status: 'ok' | 'error';
    message?: string | null;
}

export interface EmailMessageSummary {
    id: string;
    accountId: string;
    subject?: string | null;
    sender?: string | null;
    recipients: string[];
    sentAt?: string | null;
    storedPath: string;
    size: number;
    createdAt: string;
    preview?: string | null;
}

export interface EmailMessageContent extends EmailMessageSummary {
    markdown: string;
}

// Account-Level Email Memory Types (memory-v2.5)
export interface AccountMemoryStatus {
    accountId: string;
    isBuilt: boolean;
    memcellCount: number;
    episodeCount: number;
    eventLogCount: number;
    lastBuiltAt?: string | null;
}

export interface BuildAccountMemoryResult {
    success: boolean;
    message: string;
    accountId: string;
    totalMessages: number;
    memcellsCreated: number;
    episodesCreated: number;
    eventLogsCreated: number;
}

export interface AccountQAResult {
    answer: string;
    sources: AccountQASource[];
    accountId: string;
    memoriesUsed: number;
}

export interface AccountQASource {
    type: 'email_memory';
    id: string;
    subject?: string;
    sender?: string;
}

export interface MemCellItem {
    id: string;
    emailSubject: string;
    emailSender?: string | null;
    preview?: string | null;
    timestamp?: string | null;
}

export interface EpisodeItem {
    id: string;
    memcellId?: string | null;
    emailSubject?: string | null;
    summary: string;
    episode?: string | null;
    timestamp?: string | null;
}

export interface FactItem {
    id: string;
    episodeId?: string | null;
    emailSubject?: string | null;
    fact: string;
    timestamp?: string | null;
}

export interface AccountMemoryDetails {
    accountId: string;
    memcells: MemCellItem[];
    episodes: EpisodeItem[];
    facts: FactItem[];
    totalMemcells: number;
    totalEpisodes: number;
    totalFacts: number;
}
