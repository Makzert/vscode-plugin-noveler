import { PromptBuilder } from '../ai/PromptBuilder';
import { MCPServer } from '../mcp/MCPServer';
import { GenerateTextToolInput } from '../mcp/types';

export class OutlineAgent {
    public constructor(
        private readonly mcpServer: MCPServer,
        private readonly promptBuilder: PromptBuilder
    ) {}

    public async generateOutline(topic: string): Promise<string> {
        const prompt = this.promptBuilder.build({
            system: '你是资深中文长篇小说策划编辑，输出必须结构清晰、适合后续章节展开。',
            user: [
                '请基于以下小说主题生成三幕结构大纲。',
                '',
                '主题：{topic}',
                '',
                '输出要求：',
                '1. 使用 Markdown。',
                '2. 包含作品定位、核心卖点、三幕结构、主要人物弧光、关键冲突、卷/章节建议。',
                '3. 内容务实可执行，避免空泛。'
            ].join('\n'),
            variables: { topic }
        });

        return this.mcpServer.callTool<string>('generate_text', {
            system: prompt.systemPrompt ?? '',
            prompt: prompt.userPrompt,
            temperature: 0.7
        } satisfies GenerateTextToolInput);
    }
}
