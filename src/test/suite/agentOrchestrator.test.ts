import * as assert from 'assert';
import { DraftAgent } from '../../agents/DraftAgent';
import { EvaluatorAgent } from '../../agents/EvaluatorAgent';
import { MultiDraftGenerator } from '../../agents/MultiDraftGenerator';
import { OutlineAgent } from '../../agents/OutlineAgent';
import { RewriteAgent } from '../../agents/RewriteAgent';
import { AgentOrchestrator, DraftEvaluationResult } from '../../mcp/AgentOrchestrator';

suite('AgentOrchestrator Test Suite', () => {
    test('should select best draft by evaluator bestIndex', () => {
        const orchestrator = new AgentOrchestrator(
            { generateOutline: async () => '' } as unknown as OutlineAgent,
            { generateDraft: async () => '' } as unknown as DraftAgent
        );

        const drafts = ['A', 'B', 'C'];
        const evaluation: DraftEvaluationResult = {
            bestIndex: 2,
            scores: [
                { coherence: 70, emotionalTension: 70, characterPortrayal: 70, readability: 70, total: 70 },
                { coherence: 75, emotionalTension: 75, characterPortrayal: 75, readability: 75, total: 75 },
                { coherence: 90, emotionalTension: 90, characterPortrayal: 90, readability: 90, total: 90 }
            ]
        };

        const best = orchestrator.selectBestDraft(drafts, evaluation);
        assert.strictEqual(best, 'C');
    });

    test('should run full chapter pipeline with candidate-evaluate-rewrite flow', async () => {
        const orchestrator = new AgentOrchestrator(
            { generateOutline: async () => 'outline-from-topic' } as unknown as OutlineAgent,
            { generateDraft: async () => 'fallback-draft' } as unknown as DraftAgent,
            {
                generateCandidates: async () => ['candidate-1', 'candidate-2', 'candidate-3']
            } as unknown as MultiDraftGenerator,
            {
                evaluateDrafts: async () => ({
                    bestIndex: 1,
                    scores: [
                        { coherence: 70, emotionalTension: 65, characterPortrayal: 68, readability: 72, total: 68.75 },
                        { coherence: 88, emotionalTension: 86, characterPortrayal: 85, readability: 90, total: 87.25 },
                        { coherence: 80, emotionalTension: 78, characterPortrayal: 79, readability: 82, total: 79.75 }
                    ]
                })
            } as unknown as EvaluatorAgent,
            {
                rewriteDraft: async (draft: string) => `${draft}-rewritten`
            } as unknown as RewriteAgent
        );

        const result = await orchestrator.generateFullChapter({
            outline: 'given-outline',
            chapterTitle: '边城初战',
            candidateCount: 3,
            rewriteMode: 'unifyStyle'
        });

        assert.strictEqual(result.outline, 'given-outline');
        assert.strictEqual(result.bestIndex, 1);
        assert.strictEqual(result.bestDraft, 'candidate-2');
        assert.strictEqual(result.finalDraft, 'candidate-2-rewritten');
        assert.strictEqual(result.rewritten, true);
        assert.strictEqual(result.candidates.length, 3);
    });
});
