import { PromptBuilder } from '../ai/PromptBuilder';
import { ProjectContextService } from '../context/ProjectContextService';
import { MCPServer } from '../mcp/MCPServer';
import { GenerateTextToolInput } from '../mcp/types';

const FULL_CHAPTER_TIMEOUT_MS = 180000;

export class DraftAgent {
    public constructor(
        private readonly mcpServer: MCPServer,
        private readonly promptBuilder: PromptBuilder,
        private readonly projectContextService: ProjectContextService
    ) {}

    public async generateDraft(outline: string, chapterTitle: string): Promise<string> {
        const projectContext = await this.projectContextService.getProjectContext();
        const effectiveOutline = outline || projectContext.outline?.content || '';
        const characters = projectContext.characters
            .map((character) => {
                const facts = [
                    character.importance,
                    character.firstAppearance ? `初登场: ${character.firstAppearance}` : undefined,
                    character.appearance,
                    character.personality,
                    character.background
                ].filter(Boolean).join(' | ');

                return `- ${character.name}${facts ? `: ${facts}` : ''}${character.notes ? `\n  备注: ${character.notes}` : ''}`;
            })
            .join('\n');
        const references = projectContext.references
            .map((reference) => `- ${reference.title}: ${reference.content}`)
            .join('\n');
        const recentChapters = projectContext.recentChapters
            .map((chapter) => {
                const meta = [
                    chapter.chapter !== undefined ? `章节号: ${chapter.chapter}` : undefined,
                    chapter.status ? `状态: ${chapter.status}` : undefined,
                    chapter.characters?.length ? `人物: ${chapter.characters.join('、')}` : undefined,
                    chapter.locations?.length ? `地点: ${chapter.locations.join('、')}` : undefined
                ].filter(Boolean).join(' | ');

                return `- ${chapter.title}${meta ? ` (${meta})` : ''}\n  摘要: ${chapter.summary}`;
            })
            .join('\n');

        const prompt = this.promptBuilder.build({
            system: '你是专业中文网络小说作者，擅长将大纲扩写为可发布的章节初稿。',
            user: [
                '请基于以下大纲撰写章节草稿。',
                '',
                '章节标题：{chapterTitle}',
                '',
                '大纲：',
                '{outline}',
                '',
                '人物设定：',
                '{characters}',
                '',
                '参考资料：',
                '{references}',
                '',
                '最近章节：',
                '{recentChapters}',
                '',
                '输出要求：',
                '1. 使用 Markdown。',
                '2. 只输出章节正文，不要重复标题、front matter、解释说明。',
                '3. 情节推进明确，角色动机清楚，对话自然。'
            ].join('\n'),
            variables: {
                outline: effectiveOutline || '暂无大纲，请根据章节标题自行完成合理展开。',
                chapterTitle,
                characters: characters || '暂无人物设定。',
                references: references || '暂无参考资料。',
                recentChapters: recentChapters || '暂无近期章节上下文。'
            }
        });

        return this.mcpServer.callTool<string>('generate_text', {
            system: prompt.systemPrompt ?? '',
            prompt: prompt.userPrompt,
            temperature: 0.85,
            timeoutMs: FULL_CHAPTER_TIMEOUT_MS
        } satisfies GenerateTextToolInput);
    }
}
