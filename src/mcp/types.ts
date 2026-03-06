export interface MCPToolDefinition<TArgs = unknown, TResult = unknown> {
    name: string;
    description: string;
    inputSchema?: Record<string, unknown>;
    execute: (args: TArgs) => Promise<TResult>;
}

export interface MCPRequest {
    jsonrpc: '2.0';
    id: string;
    method: string;
    params?: unknown;
}

export interface MCPResponse<TResult = unknown> {
    jsonrpc: '2.0';
    id: string;
    result?: TResult;
    error?: {
        code: number;
        message: string;
    };
}

export interface GenerateTextToolInput {
    system: string;
    prompt: string;
    temperature?: number;
    maxTokens?: number;
}
