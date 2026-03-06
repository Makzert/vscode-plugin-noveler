export interface LLMConfig {
    baseUrl: string;
    apiKey: string;
    model: string;
    models?: {
        high?: string;
        medium?: string;
        low?: string;
    };
    temperature: number;
    maxTokens?: number;
    timeoutMs?: number;
}

export interface ModelOptions {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    stream?: boolean;
    systemPrompt?: string;
    timeoutMs?: number;
    onToken?: (chunk: string, accumulated: string) => void;
}

export type LLMRole = 'system' | 'user' | 'assistant';

export interface LLMMessage {
    role: LLMRole;
    content: string;
}

export interface ChatCompletionResponse {
    id?: string;
    choices?: Array<{
        index?: number;
        message?: {
            role?: string;
            content?: string | Array<{ type?: string; text?: string }>;
        };
        delta?: {
            content?: string;
        };
    }>;
    error?: {
        message?: string;
    };
}
