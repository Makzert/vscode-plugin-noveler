import { EvaluatorAgent } from '../agents/EvaluatorAgent';

export interface EvaluationScoreBreakdown {
    coherence: number;
    emotionalTension: number;
    characterPortrayal: number;
    readability: number;
    total: number;
    feedback?: string;
}

export interface EvaluationResult {
    scores: EvaluationScoreBreakdown[];
    bestIndex: number;
}

export interface EvaluateDraftsInput {
    drafts: string[];
    chapterTitle: string;
    outline: string;
}

export class EvaluationEngine {
    public constructor(private readonly evaluatorAgent?: EvaluatorAgent) {}

    public async evaluate(input: EvaluateDraftsInput): Promise<EvaluationResult> {
        if (input.drafts.length === 0) {
            throw new Error('EvaluationEngine 收到空候选列表');
        }

        if (!this.evaluatorAgent) {
            return this.evaluateWithHeuristics(input.drafts);
        }

        try {
            const result = await this.evaluatorAgent.evaluateDrafts(input.drafts, {
                chapterTitle: input.chapterTitle,
                outline: input.outline
            });
            return {
                scores: result.scores.map((score) => this.normalizeScore(score)),
                bestIndex: this.normalizeIndex(result.bestIndex, result.scores.length)
            };
        } catch {
            return this.evaluateWithHeuristics(input.drafts);
        }
    }

    private evaluateWithHeuristics(drafts: string[]): EvaluationResult {
        const scores = drafts.map((draft) => {
            const text = draft.trim();
            const paragraphCount = text.split(/\n{2,}/).filter(Boolean).length;
            const punctuationCount = (text.match(/[。！？]/g) || []).length;
            const dialogueMarks = (text.match(/[“”]/g) || []).length;
            const coherence = this.clamp(50 + Math.min(35, paragraphCount * 6));
            const emotionalTension = this.clamp(45 + Math.min(35, dialogueMarks * 3));
            const characterPortrayal = this.clamp(45 + Math.min(35, Math.floor(text.length / 180)));
            const readability = this.clamp(50 + Math.min(35, punctuationCount * 2));
            const total = Number(((coherence + emotionalTension + characterPortrayal + readability) / 4).toFixed(2));

            return {
                coherence,
                emotionalTension,
                characterPortrayal,
                readability,
                total,
                feedback: '未使用模型评分，已降级为启发式评估。'
            } satisfies EvaluationScoreBreakdown;
        });

        const bestIndex = scores.reduce((best, current, index, list) => (
            current.total > list[best].total ? index : best
        ), 0);
        return { scores, bestIndex };
    }

    private normalizeScore(score: EvaluationScoreBreakdown): EvaluationScoreBreakdown {
        return {
            coherence: this.clamp(score.coherence),
            emotionalTension: this.clamp(score.emotionalTension),
            characterPortrayal: this.clamp(score.characterPortrayal),
            readability: this.clamp(score.readability),
            total: this.clamp(score.total),
            feedback: score.feedback
        };
    }

    private normalizeIndex(index: number, size: number): number {
        if (!Number.isFinite(index) || index < 0 || index >= size) {
            return 0;
        }
        return Math.floor(index);
    }

    private clamp(value: number): number {
        if (!Number.isFinite(value)) {
            return 0;
        }
        return Math.max(0, Math.min(100, Number(value.toFixed(2))));
    }
}
