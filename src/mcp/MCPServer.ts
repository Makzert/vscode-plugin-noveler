import { Logger } from '../utils/logger';
import { ToolRegistry } from './ToolRegistry';
import { MCPRequest, MCPResponse } from './types';

export class MCPServer {
    public constructor(
        private readonly toolRegistry: ToolRegistry
    ) {}

    public registerTool = this.toolRegistry.registerTool.bind(this.toolRegistry);

    public async handleRequest(request: MCPRequest): Promise<MCPResponse> {
        try {
            if (request.method !== 'tools/call') {
                return this.errorResponse(request.id, -32601, `不支持的方法: ${request.method}`);
            }

            const params = request.params as { name?: string; arguments?: unknown } | undefined;
            const toolName = params?.name;
            if (!toolName) {
                return this.errorResponse(request.id, -32602, '缺少 tool name');
            }

            const tool = this.toolRegistry.getTool(toolName);
            if (!tool) {
                return this.errorResponse(request.id, -32601, `未找到工具: ${toolName}`);
            }

            const result = await tool.execute(params?.arguments);
            return {
                jsonrpc: '2.0',
                id: request.id,
                result
            };
        } catch (error) {
            Logger.error('[MCP] 处理请求失败', error);
            return this.errorResponse(
                request.id,
                -32000,
                error instanceof Error ? error.message : String(error)
            );
        }
    }

    public async callTool<TResult = unknown>(name: string, args?: unknown): Promise<TResult> {
        const response = await this.handleRequest({
            jsonrpc: '2.0',
            id: `${Date.now()}`,
            method: 'tools/call',
            params: {
                name,
                arguments: args
            }
        });

        if (response.error) {
            throw new Error(response.error.message);
        }

        return response.result as TResult;
    }

    private errorResponse(id: string, code: number, message: string): MCPResponse {
        return {
            jsonrpc: '2.0',
            id,
            error: {
                code,
                message
            }
        };
    }
}
