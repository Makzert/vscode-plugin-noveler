import { PromptBuilder } from '../ai/PromptBuilder';
import { MCPServer } from '../mcp/MCPServer';
import { GenerateTextToolInput } from '../mcp/types';
import { StyleProfile, buildStyleProfilePrompt } from '../style/StyleProfile';

export type RewriteMode = 'trim' | 'emotion' | 'tension' | 'unifyStyle';

export interface RewriteDraftOptions {
    mode: RewriteMode;
    chapterTitle: string;
    outline: string;
    styleProfile?: Partial<StyleProfile> & {
        target_audience?: string;
        taboo_rules?: string[];
    };
}

export class RewriteAgent {
    public constructor(
        private readonly mcpServer: MCPServer,
        private readonly promptBuilder: PromptBuilder
    ) {}

    public async rewriteDraft(draft: string, options: RewriteDraftOptions): Promise<string> {
        const prompt = this.promptBuilder.build({
            system: '你是中文小说精改编辑。只输出最终正文，不要标题、解释、代码块。',
            user: [
                `精改模式：${this.getModeDescription(options.mode)}`,
                `章节：${options.chapterTitle}`,
                '章节大纲：',
                options.outline,
                '',
                buildStyleProfilePrompt({
                    ...options.styleProfile,
                    targetAudience: options.styleProfile?.targetAudience ?? options.styleProfile?.target_audience,
                    tabooRules: options.styleProfile?.tabooRules ?? options.styleProfile?.taboo_rules
                }),
                '',
                '待精改文本：',
                draft.trim(),
                '',
                '输出要求：',
                '1. 保留核心剧情事实，不改动关键设定。',
                '2. 维持叙事连续性与人物一致性。',
                '3. 只返回正文。'
            ].filter(Boolean).join('\n')
        });

        return this.mcpServer.callTool<string>('generate_text', {
            system: prompt.systemPrompt ?? '',
            prompt: prompt.userPrompt,
            temperature: 0.65
        } satisfies GenerateTextToolInput);
    }

    private getModeDescription(mode: RewriteMode): string {
        switch (mode) {
            case 'trim':
                return '精简冗余表达，压缩废话，保持信息密度。';
            case 'emotion':
                return '强化情绪感染力与角色心理波动。';
            case 'tension':
                return '提升冲突张力与场景推进压力。';
            case 'unifyStyle':
                return '统一文风、语气和节奏，减少跳脱感。';
        }
    }
}
