import { DraftAgent } from '../agents/DraftAgent';
import { EvaluatorAgent } from '../agents/EvaluatorAgent';
import { MultiDraftGenerator } from '../agents/MultiDraftGenerator';
import { OutlineAgent } from '../agents/OutlineAgent';
import { RewriteAgent } from '../agents/RewriteAgent';
import { AIResponseSanitizer } from '../ai/AIResponseSanitizer';
import { ChapterPipeline } from '../pipeline/ChapterPipeline';
import { StyleProfile } from '../style/StyleProfile';
import { EvaluationEngine } from './EvaluationEngine';
import { TaskQueue } from './TaskQueue';

export type RewriteMode = 'trim' | 'emotion' | 'tension' | 'unifyStyle';

export interface DraftScoreBreakdown {
    coherence: number;
    emotionalTension: number;
    characterPortrayal: number;
    readability: number;
    total: number;
    feedback?: string;
}

export interface DraftEvaluationResult {
    scores: DraftScoreBreakdown[];
    bestIndex: number;
}

export interface FullChapterRequest {
    outline: string;
    chapterTitle: string;
    candidateCount?: number;
    rewriteMode?: RewriteMode;
    styleProfile?: Partial<StyleProfile>;
}

export interface FullChapterResult {
    outline: string;
    chapterTitle: string;
    candidates: string[];
    evaluation: DraftEvaluationResult;
    bestIndex: number;
    bestDraft: string;
    finalDraft: string;
    rewritten: boolean;
}

export class AgentOrchestrator {
    private readonly chapterPipeline: ChapterPipeline;
    private readonly evaluationEngine: EvaluationEngine;
    private readonly taskQueue: TaskQueue;
    private readonly responseSanitizer: AIResponseSanitizer;

    public constructor(
        private readonly outlineAgent: OutlineAgent,
        private readonly draftAgent: DraftAgent,
        private readonly multiDraftGenerator?: MultiDraftGenerator,
        private readonly evaluatorAgent?: EvaluatorAgent,
        private readonly rewriteAgent?: RewriteAgent,
        chapterPipeline?: ChapterPipeline,
        evaluationEngine?: EvaluationEngine,
        taskQueue?: TaskQueue,
        responseSanitizer?: AIResponseSanitizer
    ) {
        this.chapterPipeline = chapterPipeline ?? new ChapterPipeline();
        this.evaluationEngine = evaluationEngine ?? new EvaluationEngine(this.evaluatorAgent);
        this.taskQueue = taskQueue ?? new TaskQueue(1);
        this.responseSanitizer = responseSanitizer ?? new AIResponseSanitizer();
    }

    public async createOutline(topic: string): Promise<string> {
        return this.outlineAgent.generateOutline(topic);
    }

    public async createChapterDraft(outline: string, chapterTitle: string): Promise<string> {
        const raw = await this.draftAgent.generateDraft(outline, chapterTitle);
        return this.sanitizeGeneratedProse(raw, chapterTitle) || raw.trim();
    }

    public async generateMultiDraftCandidates(
        outline: string,
        chapterTitle: string,
        candidateCount = 3
    ): Promise<string[]> {
        const count = Math.max(1, Math.floor(candidateCount));

        if (this.multiDraftGenerator) {
            const generated = await this.multiDraftGenerator.generateCandidates(outline, chapterTitle, count);
            const normalized = generated
                .map((item) => this.sanitizeGeneratedProse(item, chapterTitle))
                .filter((item) => item.length > 0)
                .map((item) => item.trim())
                .filter((item) => item.length > 0);
            if (normalized.length > 0) {
                return normalized;
            }
        }

        const drafts = await Promise.all(
            Array.from({ length: count }, async () => this.draftAgent.generateDraft(outline, chapterTitle))
        );

        return drafts
            .map((item) => this.sanitizeGeneratedProse(item, chapterTitle))
            .filter((item) => item.length > 0)
            .map((item) => item.trim())
            .filter((item) => item.length > 0);
    }

    public async evaluateDrafts(
        drafts: string[],
        context: {
            chapterTitle: string;
            outline: string;
        }
    ): Promise<DraftEvaluationResult> {
        return this.evaluationEngine.evaluate({
            drafts,
            chapterTitle: context.chapterTitle,
            outline: context.outline
        });
    }

    public selectBestDraft(drafts: string[], evaluation: DraftEvaluationResult): string {
        if (drafts.length === 0) {
            throw new Error('缺少候选草稿，无法选优');
        }

        const index = this.normalizeBestIndex(evaluation.bestIndex, drafts.length);
        return drafts[index];
    }

    public async rewriteWithStyle(
        draft: string,
        options: {
            mode?: RewriteMode;
            chapterTitle: string;
            outline: string;
            styleProfile?: Partial<StyleProfile>;
        }
    ): Promise<string> {
        if (!draft.trim()) {
            throw new Error('草稿内容为空，无法精改');
        }

        if (!this.rewriteAgent) {
            return draft.trim();
        }

        const rewritten = await this.rewriteAgent.rewriteDraft(draft, {
            mode: options.mode ?? 'unifyStyle',
            chapterTitle: options.chapterTitle,
            outline: options.outline,
            styleProfile: options.styleProfile
        });

        const sanitized = this.sanitizeGeneratedProse(rewritten, options.chapterTitle);
        return sanitized || draft.trim();
    }

    public async generateFullChapter(request: FullChapterRequest): Promise<FullChapterResult> {
        const task = await this.taskQueue.enqueue(
            () => this.chapterPipeline.run(request, {
                createChapterDraft: this.createChapterDraft.bind(this),
                generateMultiDraftCandidates: this.generateMultiDraftCandidates.bind(this),
                evaluateDrafts: this.evaluateDrafts.bind(this),
                selectBestDraft: this.selectBestDraft.bind(this),
                rewriteWithStyle: this.rewriteWithStyle.bind(this)
            }),
            { label: `full-chapter:${request.chapterTitle}` }
        );

        if (task.status === 'failed') {
            throw new Error(task.error || '全流程章节任务执行失败');
        }

        if (!task.result) {
            throw new Error('全流程章节任务未返回有效结果');
        }

        return task.result as FullChapterResult;
    }

    private normalizeBestIndex(index: number, size: number): number {
        if (!Number.isFinite(index) || index < 0 || index >= size) {
            return 0;
        }
        return Math.floor(index);
    }

    private sanitizeGeneratedProse(raw: string, chapterTitle: string): string {
        const sanitized = this.responseSanitizer.sanitize(raw, {
            chapterTitle,
            mode: 'prose'
        }).content.trim();

        if (this.looksLikeLeakedReasoning(sanitized)) {
            return '';
        }

        return sanitized;
    }

    private looksLikeLeakedReasoning(content: string): boolean {
        const normalized = content.trim();
        if (!normalized) {
            return false;
        }

        if (/^(?:<\/?(?:think|thinking)|nk)>/i.test(normalized)) {
            return true;
        }

        if (/(?:^|\n)输出要求：\s*1\./.test(normalized) && /用户(?:消息|给了)/.test(normalized)) {
            return true;
        }

        return false;
    }
}
