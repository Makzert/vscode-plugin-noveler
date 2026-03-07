import { PromptBuilder } from '../ai/PromptBuilder';
import { MCPServer } from '../mcp/MCPServer';
import { GenerateTextToolInput } from '../mcp/types';

export class MultiDraftGenerator {
    public constructor(
        private readonly mcpServer: MCPServer,
        private readonly promptBuilder: PromptBuilder
    ) {}

    public async generateCandidates(outline: string, chapterTitle: string, candidateCount: number): Promise<string[]> {
        const count = Math.max(1, Math.min(8, Math.floor(candidateCount)));
        const tasks: Array<Promise<string>> = [];

        for (let index = 0; index < count; index++) {
            const built = this.promptBuilder.build({
                system: '你是中文网络小说作者，输出可发布章节初稿。',
                user: [
                    `章节标题：${chapterTitle}`,
                    '',
                    '大纲：',
                    outline,
                    '',
                    `候选序号：${index + 1}`,
                    '请保证每个候选在表述细节、节奏处理上有可区分差异。',
                    '只输出章节正文，不要解释。'
                ].join('\n')
            });

            tasks.push(this.mcpServer.callTool<string>('generate_text', {
                system: built.systemPrompt ?? '',
                prompt: built.userPrompt,
                temperature: 0.9
            } satisfies GenerateTextToolInput));
        }

        const results = await Promise.all(tasks);
        return results.map((item) => item.trim()).filter((item) => item.length > 0);
    }
}
