import * as assert from 'assert';
import { MCPServer } from '../../mcp/MCPServer';
import { ToolRegistry } from '../../mcp/ToolRegistry';

suite('MCPServer Test Suite', () => {
    test('should call registered tool successfully', async () => {
        const registry = new ToolRegistry();
        const server = new MCPServer(registry);

        server.registerTool({
            name: 'echo',
            description: 'echo tool',
            execute: async (args) => (args as { text: string }).text
        });

        const result = await server.callTool<string>('echo', { text: 'hello' });
        assert.strictEqual(result, 'hello');
    });

    test('should return error for unknown tool', async () => {
        const registry = new ToolRegistry();
        const server = new MCPServer(registry);

        await assert.rejects(
            () => server.callTool('missing-tool', {}),
            /未找到工具/
        );
    });
});
