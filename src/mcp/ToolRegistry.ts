import { MCPToolDefinition } from './types';

export class ToolRegistry {
    private readonly tools = new Map<string, MCPToolDefinition>();

    public registerTool(definition: MCPToolDefinition): void {
        this.tools.set(definition.name, definition);
    }

    public getTool(name: string): MCPToolDefinition | undefined {
        return this.tools.get(name);
    }

    public listTools(): MCPToolDefinition[] {
        return Array.from(this.tools.values());
    }
}
