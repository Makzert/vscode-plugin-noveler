import { StyleProfile } from '../style/StyleProfile';

export type PipelineRewriteMode = 'trim' | 'emotion' | 'tension' | 'unifyStyle';

export interface PipelineDraftScoreBreakdown {
    coherence: number;
    emotionalTension: number;
    characterPortrayal: number;
    readability: number;
    total: number;
    feedback?: string;
}

export interface PipelineDraftEvaluationResult {
    scores: PipelineDraftScoreBreakdown[];
    bestIndex: number;
}

export interface ChapterPipelineRequest {
    outline: string;
    chapterTitle: string;
    candidateCount?: number;
    rewriteMode?: PipelineRewriteMode;
    styleProfile?: Partial<StyleProfile>;
}

export interface ChapterPipelineResult {
    outline: string;
    chapterTitle: string;
    candidates: string[];
    evaluation: PipelineDraftEvaluationResult;
    bestIndex: number;
    bestDraft: string;
    finalDraft: string;
    rewritten: boolean;
}

export interface ChapterPipelineContext {
    createChapterDraft: (outline: string, chapterTitle: string) => Promise<string>;
    generateMultiDraftCandidates: (outline: string, chapterTitle: string, candidateCount: number) => Promise<string[]>;
    evaluateDrafts: (
        drafts: string[],
        context: { chapterTitle: string; outline: string }
    ) => Promise<PipelineDraftEvaluationResult>;
    selectBestDraft: (drafts: string[], evaluation: PipelineDraftEvaluationResult) => string;
    rewriteWithStyle: (
        draft: string,
        options: {
            mode?: PipelineRewriteMode;
            chapterTitle: string;
            outline: string;
            styleProfile?: Partial<StyleProfile>;
        }
    ) => Promise<string>;
}

export class ChapterPipeline {
    public async run(
        request: ChapterPipelineRequest,
        context: ChapterPipelineContext
    ): Promise<ChapterPipelineResult> {
        const outline = request.outline?.trim();
        const chapterTitle = request.chapterTitle?.trim();
        const candidateCount = Math.max(1, Math.floor(request.candidateCount ?? 3));

        if (!outline) {
            throw new Error('生成全流程章节失败：缺少大纲内容');
        }
        if (!chapterTitle) {
            throw new Error('生成全流程章节失败：缺少章节标题');
        }

        let candidates = await context.generateMultiDraftCandidates(outline, chapterTitle, candidateCount);
        if (candidates.length === 0) {
            const draft = await context.createChapterDraft(outline, chapterTitle);
            candidates = draft.trim() ? [draft.trim()] : [];
        }
        if (candidates.length === 0) {
            throw new Error('生成全流程章节失败：未获得有效候选草稿');
        }

        const evaluation = await context.evaluateDrafts(candidates, { chapterTitle, outline });
        const bestIndex = this.normalizeBestIndex(evaluation.bestIndex, candidates.length);
        const bestDraft = context.selectBestDraft(candidates, evaluation);
        const finalDraft = await context.rewriteWithStyle(bestDraft, {
            mode: request.rewriteMode,
            chapterTitle,
            outline,
            styleProfile: request.styleProfile
        });

        return {
            outline,
            chapterTitle,
            candidates,
            evaluation,
            bestIndex,
            bestDraft,
            finalDraft,
            rewritten: finalDraft.trim() !== bestDraft.trim()
        };
    }

    private normalizeBestIndex(index: number, size: number): number {
        if (!Number.isFinite(index) || index < 0 || index >= size) {
            return 0;
        }
        return Math.floor(index);
    }
}
