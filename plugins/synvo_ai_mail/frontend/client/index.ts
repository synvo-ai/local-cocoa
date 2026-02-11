/**
 * Email Plugin Backend Client
 * Handles all email-related API calls to the backend
 * Moved from src/main/backendClient.ts for plugin modularity
 */

import { requestJson, resolveEndpoint } from '@/main/backendClient';
import type {
    EmailAccountPayload,
    EmailAccountSummary,
    EmailSyncResult,
    EmailMessageSummary,
    EmailMessageContent,
    AccountMemoryStatus,
    BuildAccountMemoryResult,
    AccountQAResult,
    AccountMemoryDetails,
} from '../types';

import { API_PREFIX } from '../config';

const MAIL_PLUGIN_PREFIX = API_PREFIX;

// ==================== Mapper Functions ====================

function mapEmailAccount(payload: any): EmailAccountSummary {
    return {
        id: String(payload.id ?? payload.account_id ?? ''),
        label: payload.label ?? 'Email account',
        protocol: (payload.protocol ?? 'imap') as EmailAccountSummary['protocol'],
        host: payload.host ?? '',
        port: Number(payload.port ?? 0),
        username: payload.username ?? '',
        useSsl: Boolean(payload.use_ssl ?? payload.useSsl ?? true),
        folder: payload.folder ?? null,
        enabled: Boolean(payload.enabled ?? true),
        createdAt: payload.created_at ?? payload.createdAt ?? new Date().toISOString(),
        updatedAt: payload.updated_at ?? payload.updatedAt ?? new Date().toISOString(),
        lastSyncedAt: payload.last_synced_at ?? payload.lastSyncedAt ?? null,
        lastSyncStatus: payload.last_sync_status ?? payload.lastSyncStatus ?? null,
        totalMessages: Number(payload.total_messages ?? payload.totalMessages ?? 0),
        recentNewMessages: Number(payload.recent_new_messages ?? payload.recentNewMessages ?? 0),
        folderId: String(payload.folder_id ?? payload.folderId ?? ''),
        folderPath: payload.folder_path ?? payload.folderPath ?? ''
    };
}

function mapEmailSyncResult(payload: any): EmailSyncResult {
    return {
        accountId: String(payload.account_id ?? payload.accountId ?? ''),
        folderId: String(payload.folder_id ?? payload.folderId ?? ''),
        folderPath: payload.folder_path ?? payload.folderPath ?? '',
        newMessages: Number(payload.new_messages ?? payload.newMessages ?? 0),
        totalMessages: Number(payload.total_messages ?? payload.totalMessages ?? 0),
        indexed: Number(payload.indexed ?? 0),
        lastSyncedAt: payload.last_synced_at ?? payload.lastSyncedAt ?? new Date().toISOString(),
        status: (payload.status ?? 'ok') as EmailSyncResult['status'],
        message: payload.message ?? null
    };
}

function mapEmailMessageSummary(payload: any): EmailMessageSummary {
    return {
        id: String(payload.id ?? ''),
        accountId: String(payload.account_id ?? payload.accountId ?? ''),
        subject: payload.subject ?? null,
        sender: payload.sender ?? null,
        recipients: Array.isArray(payload.recipients) ? payload.recipients.map(String) : [],
        sentAt: payload.sent_at ?? payload.sentAt ?? null,
        storedPath: payload.stored_path ?? payload.storedPath ?? '',
        size: Number(payload.size ?? 0),
        createdAt: payload.created_at ?? payload.createdAt ?? new Date().toISOString(),
        preview: payload.preview ?? null
    };
}

function mapEmailMessageContent(payload: any): EmailMessageContent {
    const summary = mapEmailMessageSummary(payload);
    return {
        ...summary,
        markdown: payload.markdown ?? ''
    };
}

// ==================== Email Account Functions ====================

export async function listEmailAccounts(): Promise<EmailAccountSummary[]> {
    const data = await requestJson<any[]>(`${MAIL_PLUGIN_PREFIX}/accounts`, { method: 'GET' });
    const payload = Array.isArray(data) ? data : [];
    return payload.map(mapEmailAccount);
}

export async function startOutlookAuth(clientId: string, tenantId: string): Promise<{ flow_id: string }> {
    return requestJson(`${MAIL_PLUGIN_PREFIX}/outlook/auth`, {
        method: 'POST',
        body: JSON.stringify({ client_id: clientId, tenant_id: tenantId })
    });
}

export async function getOutlookAuthStatus(flowId: string): Promise<any> {
    return requestJson(`${MAIL_PLUGIN_PREFIX}/outlook/auth/${flowId}`, { method: 'GET' });
}

export async function completeOutlookSetup(flowId: string, label: string): Promise<EmailAccountSummary> {
    const data = await requestJson<any>(`${MAIL_PLUGIN_PREFIX}/outlook/complete`, {
        method: 'POST',
        body: JSON.stringify({ flow_id: flowId, label })
    });
    return mapEmailAccount(data);
}

export async function addEmailAccount(payload: EmailAccountPayload): Promise<EmailAccountSummary> {
    const body = {
        label: payload.label,
        protocol: payload.protocol,
        host: payload.host,
        port: payload.port,
        username: payload.username,
        password: payload.password,
        use_ssl: payload.useSsl ?? true,
        folder: payload.folder
    };
    const data = await requestJson(`${MAIL_PLUGIN_PREFIX}/accounts`, {
        method: 'POST',
        body: JSON.stringify(body)
    });
    return mapEmailAccount(data);
}

export async function removeEmailAccount(accountId: string): Promise<void> {
    await requestJson(`${MAIL_PLUGIN_PREFIX}/accounts/${encodeURIComponent(accountId)}`, { method: 'DELETE' });
}

export async function syncEmailAccount(accountId: string, limit?: number): Promise<EmailSyncResult> {
    const payload = {
        limit: limit ?? 100
    };
    const data = await requestJson(`${MAIL_PLUGIN_PREFIX}/accounts/${encodeURIComponent(accountId)}/sync`, {
        method: 'POST',
        body: JSON.stringify(payload)
    });
    return mapEmailSyncResult(data);
}

export async function listEmailMessages(accountId: string, limit = 50): Promise<EmailMessageSummary[]> {
    const url = new URL(resolveEndpoint(`${MAIL_PLUGIN_PREFIX}/accounts/${encodeURIComponent(accountId)}/messages`));
    url.searchParams.set('limit', String(limit));
    const data = await requestJson<any[]>(url.toString(), { method: 'GET' });
    const payload = Array.isArray(data) ? data : [];
    return payload.map(mapEmailMessageSummary);
}

export async function getEmailMessage(messageId: string): Promise<EmailMessageContent> {
    const data = await requestJson(`${MAIL_PLUGIN_PREFIX}/messages/${encodeURIComponent(messageId)}`, { method: 'GET' });
    return mapEmailMessageContent(data);
}

// ==================== Account-Level Email Memory Functions ====================

export async function buildAccountMemory(
    accountId: string,
    userId: string = 'default_user'
): Promise<BuildAccountMemoryResult> {
    const data = await requestJson<any>(
        `${MAIL_PLUGIN_PREFIX}/accounts/${encodeURIComponent(accountId)}/build-memory`,
        {
            method: 'POST',
            body: JSON.stringify({
                user_id: userId
            })
        }
    );
    return {
        success: data.success ?? false,
        message: data.message ?? '',
        accountId: data.account_id ?? accountId,
        totalMessages: data.total_messages ?? 0,
        memcellsCreated: data.memcells_created ?? 0,
        episodesCreated: data.episodes_created ?? 0,
        eventLogsCreated: data.event_logs_created ?? 0,
    };
}

export async function getAccountMemoryStatus(
    accountId: string,
    userId: string = 'default_user'
): Promise<AccountMemoryStatus> {
    const url = new URL(resolveEndpoint(`${MAIL_PLUGIN_PREFIX}/accounts/${encodeURIComponent(accountId)}/memory-status`));
    url.searchParams.set('user_id', userId);
    const data = await requestJson<any>(url.toString(), { method: 'GET' });
    return {
        accountId: data.account_id ?? accountId,
        isBuilt: data.is_built ?? false,
        memcellCount: data.memcell_count ?? 0,
        episodeCount: data.episode_count ?? 0,
        eventLogCount: data.event_log_count ?? 0,
        lastBuiltAt: data.last_built_at ?? null,
    };
}

export async function accountQA(
    accountId: string,
    question: string,
    userId: string = 'default_user'
): Promise<AccountQAResult> {
    const data = await requestJson<any>(
        `${MAIL_PLUGIN_PREFIX}/accounts/${encodeURIComponent(accountId)}/qa`,
        {
            method: 'POST',
            body: JSON.stringify({
                question,
                user_id: userId
            })
        }
    );
    return {
        answer: data.answer ?? '',
        sources: (data.sources ?? []).map((s: any) => ({
            type: s.type ?? 'email_memory',
            id: s.id ?? '',
            subject: s.subject ?? '',
            sender: s.sender ?? '',
        })),
        accountId: data.account_id ?? accountId,
        memoriesUsed: data.memories_used ?? 0,
    };
}

export async function getAccountMemoryDetails(
    accountId: string,
    userId: string = 'default_user',
    limit: number = 50
): Promise<AccountMemoryDetails> {
    const url = new URL(resolveEndpoint(`${MAIL_PLUGIN_PREFIX}/accounts/${encodeURIComponent(accountId)}/memory-details`));
    url.searchParams.set('user_id', userId);
    url.searchParams.set('limit', String(limit));
    const data = await requestJson<any>(url.toString(), { method: 'GET' });
    console.log('[EmailClient] getAccountMemoryDetails raw response:', JSON.stringify(data, null, 2).substring(0, 1000));
    return {
        accountId: data.account_id ?? accountId,
        memcells: (data.memcells ?? []).map((mc: any) => ({
            id: mc.id ?? '',
            emailSubject: mc.email_subject ?? '(No Subject)',
            emailSender: mc.email_sender ?? null,
            preview: mc.preview ?? null,
            timestamp: mc.timestamp ?? null,
        })),
        episodes: (data.episodes ?? []).map((ep: any) => ({
            id: ep.id ?? '',
            memcellId: ep.memcell_id ?? null,
            emailSubject: ep.email_subject ?? null,
            summary: ep.summary ?? '',
            episode: ep.episode ?? null,
            timestamp: ep.timestamp ?? null,
        })),
        facts: (data.facts ?? []).map((f: any) => ({
            id: f.id ?? '',
            episodeId: f.episode_id ?? null,
            emailSubject: f.email_subject ?? null,
            fact: f.fact ?? '',
            timestamp: f.timestamp ?? null,
        })),
        totalMemcells: data.total_memcells ?? 0,
        totalEpisodes: data.total_episodes ?? 0,
        totalFacts: data.total_facts ?? 0,
    };
}
