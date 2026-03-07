import { PromptBuilder } from '../ai/PromptBuilder';
import { MCPServer } from '../mcp/MCPServer';
import { GenerateTextToolInput } from '../mcp/types';

export interface DraftDimensionScore {
    coherence: number;
    emotionalTension: number;
    characterPortrayal: number;
    readability: number;
    total: number;
    feedback?: string;
}

export interface DraftEvaluationResult {
    scores: DraftDimensionScore[];
    bestIndex: number;
}

export class EvaluatorAgent {
    public constructor(
        private readonly mcpServer: MCPServer,
        private readonly promptBuilder: PromptBuilder
    ) {}

    public async evaluateDrafts(
        drafts: string[],
        context: {
            chapterTitle: string;
            outline: string;
        }
    ): Promise<DraftEvaluationResult> {
        if (drafts.length === 0) {
            throw new Error('EvaluatorAgent 收到空候选列表');
        }

        const prompt = this.promptBuilder.build({
            system: '你是小说编辑评审器，只返回 JSON，不要 Markdown，不要解释。',
            user: [
                `章节标题：${context.chapterTitle}`,
                '请对以下候选草稿评分，并返回 JSON。',
                '评分维度（0-100）：连贯性(coherence)、情绪张力(emotionalTension)、人物塑造(characterPortrayal)、可读性(readability)。',
                'total 为四项均值。',
                '返回格式：',
                '{"bestIndex":0,"scores":[{"coherence":0,"emotionalTension":0,"characterPortrayal":0,"readability":0,"total":0,"feedback":""}]}',
                '',
                ...drafts.map((candidate, index) => `候选#${index}\n${candidate}`)
            ].join('\n\n')
        });

        const raw = await this.mcpServer.callTool<string>('generate_text', {
            system: prompt.systemPrompt ?? '',
            prompt: prompt.userPrompt,
            temperature: 0.2
        } satisfies GenerateTextToolInput);

        return this.parseResult(raw, drafts.length);
    }

    private parseResult(raw: string, candidateCount: number): DraftEvaluationResult {
        let normalized = raw.trim();
        normalized = normalized.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim();
        const parsed = JSON.parse(normalized) as Partial<DraftEvaluationResult>;

        const scores = Array.isArray(parsed.scores) ? parsed.scores : [];
        const normalizedScores: DraftDimensionScore[] = scores
            .slice(0, candidateCount)
            .map((item) => {
                const source = item as Partial<DraftDimensionScore>;
                const coherence = this.toScore(source.coherence);
                const emotionalTension = this.toScore(source.emotionalTension);
                const characterPortrayal = this.toScore(source.characterPortrayal);
                const readability = this.toScore(source.readability);
                const total = source.total ?? Number(((coherence + emotionalTension + characterPortrayal + readability) / 4).toFixed(2));

                return {
                    coherence,
                    emotionalTension,
                    characterPortrayal,
                    readability,
                    total: Number.isFinite(total) ? Number(total) : 0,
                    feedback: typeof source.feedback === 'string' ? source.feedback.trim() : undefined
                };
            })
            .filter((item) => Number.isFinite(item.total));

        if (normalizedScores.length === 0) {
            throw new Error('EvaluatorAgent 返回结果缺少有效评分项');
        }

        while (normalizedScores.length < candidateCount) {
            normalizedScores.push({
                coherence: 0,
                emotionalTension: 0,
                characterPortrayal: 0,
                readability: 0,
                total: 0
            });
        }

        const fallbackBest = normalizedScores.reduce((best, current, index, list) => {
            return current.total > list[best].total ? index : best;
        }, 0);

        return {
            bestIndex: this.normalizeIndex(parsed.bestIndex, fallbackBest, candidateCount),
            scores: normalizedScores
        };
    }

    private toScore(value: unknown): number {
        const numeric = typeof value === 'number' ? value : Number(value);
        if (!Number.isFinite(numeric)) {
            return 0;
        }
        return Math.max(0, Math.min(10, numeric));
    }

    private normalizeIndex(value: unknown, fallback: number, max: number): number {
        const index = typeof value === 'number' ? Math.floor(value) : Number(value);
        if (Number.isFinite(index) && index >= 0 && index < max) {
            return index;
        }
        return fallback;
    }
}
