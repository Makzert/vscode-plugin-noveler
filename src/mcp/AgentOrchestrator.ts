import { DraftAgent } from '../agents/DraftAgent';
import { OutlineAgent } from '../agents/OutlineAgent';

export class AgentOrchestrator {
    public constructor(
        private readonly outlineAgent: OutlineAgent,
        private readonly draftAgent: DraftAgent
    ) {}

    public async createOutline(topic: string): Promise<string> {
        return this.outlineAgent.generateOutline(topic);
    }

    public async createChapterDraft(outline: string, chapterTitle: string): Promise<string> {
        return this.draftAgent.generateDraft(outline, chapterTitle);
    }
}
