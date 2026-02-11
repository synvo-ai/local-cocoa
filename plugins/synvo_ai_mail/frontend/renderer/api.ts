import type {
    EmailAccountPayload,
    EmailAccountSummary,
    EmailSyncResult,
    EmailMessageSummary,
    EmailMessageContent,
    BuildAccountMemoryResult,
    AccountMemoryStatus,
    AccountMemoryDetails,
    AccountQAResult
} from '../types';

const PLUGIN_ID = 'synvo_ai_mail';

export const mailAPI = {
    listAccounts: (): Promise<EmailAccountSummary[]> =>
        window.api.pluginInvoke(PLUGIN_ID, 'list'),

    addAccount: (payload: EmailAccountPayload): Promise<EmailAccountSummary> =>
        window.api.pluginInvoke(PLUGIN_ID, 'add', payload),

    removeAccount: (accountId: string): Promise<{ id: string }> =>
        window.api.pluginInvoke(PLUGIN_ID, 'remove', accountId),

    syncAccount: (accountId: string, limit?: number): Promise<EmailSyncResult> =>
        window.api.pluginInvoke(PLUGIN_ID, 'sync', { accountId, limit }),

    listMessages: (accountId: string, limit?: number): Promise<EmailMessageSummary[]> =>
        window.api.pluginInvoke(PLUGIN_ID, 'messages', { accountId, limit }),

    getMessage: (messageId: string): Promise<EmailMessageContent> =>
        window.api.pluginInvoke(PLUGIN_ID, 'message', { messageId }),

    startOutlookAuth: (clientId: string, tenantId: string): Promise<{ flow_id: string }> =>
        window.api.pluginInvoke(PLUGIN_ID, 'outlook:auth', { clientId, tenantId }),

    getOutlookAuthStatus: (flowId: string): Promise<any> =>
        window.api.pluginInvoke(PLUGIN_ID, 'outlook:status', flowId),

    completeOutlookSetup: (flowId: string, label: string): Promise<EmailAccountSummary> =>
        window.api.pluginInvoke(PLUGIN_ID, 'outlook:complete', { flowId, label }),

    // Memory APIs
    buildAccountMemory: (accountId: string, userId?: string): Promise<BuildAccountMemoryResult> =>
        window.api.pluginInvoke(PLUGIN_ID, 'build-account-memory', { accountId, userId }),

    getAccountMemoryStatus: (accountId: string, userId?: string): Promise<AccountMemoryStatus> =>
        window.api.pluginInvoke(PLUGIN_ID, 'account-memory-status', { accountId, userId }),

    getAccountMemoryDetails: (accountId: string, userId?: string, limit?: number): Promise<AccountMemoryDetails> =>
        window.api.pluginInvoke(PLUGIN_ID, 'account-memory-details', { accountId, userId, limit }),

    accountQA: (accountId: string, question: string, userId?: string): Promise<AccountQAResult> =>
        window.api.pluginInvoke(PLUGIN_ID, 'account-qa', { accountId, question, userId })
};
