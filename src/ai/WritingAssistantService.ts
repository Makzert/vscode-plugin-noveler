import * as path from 'path';
import * as vscode from 'vscode';
import { LLMClient } from './LLMClient';
import { AIResponseSanitizer } from './AIResponseSanitizer';
import { ProjectContextService } from '../context/ProjectContextService';
import { ModelRouter } from './ModelRouter';

export type WritingAssistantMode = 'continue' | 'rewrite' | 'expand' | 'polishDialogue' | 'summarize';
export type WritingAssistantTarget = 'insert' | 'replace' | 'append';

export interface WritingAssistantRequest {
    mode: WritingAssistantMode;
    prompt: string;
    target: WritingAssistantTarget;
    onPreviewChunk?: (content: string) => void;
}

export interface WritingAssistantResult {
    content: string;
    warnings: string[];
    changed: boolean;
    mode: WritingAssistantMode;
    target: WritingAssistantTarget;
    sourceRange?: vscode.Range;
    sourceUri?: string;
}

interface ActiveEditorSnapshot {
    documentUri: string;
    fileName: string;
    chapterTitle: string;
    hasSelection: boolean;
    selectionText: string;
    selectionRange?: vscode.Range;
    currentParagraph: string;
    currentParagraphRange?: vscode.Range;
    beforeCursor: string;
    afterCursor: string;
    documentExcerpt: string;
}

export interface WritingAssistantContextSummary {
    fileName: string;
    chapterTitle: string;
    hasSelection: boolean;
    selectionLength: number;
    currentParagraph: string;
}

export class WritingAssistantService {
    public constructor(
        private readonly llmClient: LLMClient,
        private readonly projectContextService: ProjectContextService,
        private readonly sanitizer: AIResponseSanitizer,
        private readonly modelRouter: ModelRouter
    ) {}

    public getActiveEditorContextSummary(): WritingAssistantContextSummary | undefined {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'markdown') {
            return undefined;
        }

        const snapshot = this.captureActiveEditor(editor);
        return {
            fileName: snapshot.fileName,
            chapterTitle: snapshot.chapterTitle,
            hasSelection: snapshot.hasSelection,
            selectionLength: snapshot.selectionText.length,
            currentParagraph: snapshot.currentParagraph
        };
    }

    public async generate(request: WritingAssistantRequest): Promise<WritingAssistantResult> {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'markdown') {
            throw new Error('请先打开一个 Markdown 章节文件。');
        }

        const snapshot = this.captureActiveEditor(editor);
        const projectContext = await this.projectContextService.getProjectContext();
        const { systemPrompt, userPrompt } = this.buildPrompt(request, snapshot, projectContext);

        const raw = await this.llmClient.generateMessages([
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
        ], {
            model: this.modelRouter.resolveModel(this.llmClient.getConfigSnapshot(), request.mode === 'summarize' ? 'medium' : 'high'),
            temperature: request.mode === 'summarize' ? 0.5 : 0.85
            ,
            stream: true,
            onToken: (_chunk, accumulated) => {
                request.onPreviewChunk?.(this.sanitizer.sanitizePreview(accumulated, {
                    chapterTitle: snapshot.chapterTitle,
                    mode: request.mode === 'summarize' ? 'summary' : 'prose'
                }));
            }
        });

        const sanitized = this.sanitizer.sanitize(raw, {
            chapterTitle: snapshot.chapterTitle,
            mode: request.mode === 'summarize' ? 'summary' : 'prose'
        });

        if (!sanitized.content) {
            throw new Error('AI 返回内容为空，无法应用。');
        }

        return {
            content: sanitized.content,
            warnings: sanitized.warnings,
            changed: sanitized.changed,
            mode: request.mode,
            target: request.target,
            sourceRange: this.resolveSourceRange(request.mode, request.target, snapshot),
            sourceUri: snapshot.documentUri
        };
    }

    public extractPotentialCharacterNames(text: string): string[] {
        const chineseNamePattern = /(?:欧阳|上官|司马|诸葛|赵|钱|孙|李|周|吴|郑|王|冯|陈|褚|卫|蒋|沈|韩|杨|朱|秦|尤|许|何|吕|施|张|孔|曹|严|华|金|魏|陶|姜|谢|邹|喻|潘|葛|范|彭|郎|鲁|韦|马|苗|方|俞|任|袁|柳|唐|罗|薛|伍|余|姚|孟|顾|尹|江|钟|傅|邓|萧)[\u4e00-\u9fa5]{1,2}/g;
        const counts = new Map<string, number>();
        for (const match of text.match(chineseNamePattern) || []) {
            counts.set(match, (counts.get(match) || 0) + 1);
        }

        return Array.from(counts.entries())
            .filter(([name, count]) => count >= 1 && !['一声', '一个', '一种', '那人', '这时'].includes(name))
            .map(([name]) => name);
    }

    private buildPrompt(
        request: WritingAssistantRequest,
        snapshot: ActiveEditorSnapshot,
        projectContext: Awaited<ReturnType<ProjectContextService['getProjectContext']>>
    ): { systemPrompt: string; userPrompt: string } {
        const secondaryOutline = projectContext.outline?.content
            ? projectContext.outline.content.slice(0, 1200)
            : '暂无可用大纲。';
        const characters = projectContext.characters
            .slice(0, 8)
            .map((character) => {
                const facts = [
                    character.importance,
                    character.personality,
                    character.background
                ].filter(Boolean).join(' | ');
                return `- ${character.name}${facts ? `：${facts}` : ''}`;
            })
            .join('\n') || '暂无人物设定。';
        const recentChapters = projectContext.recentChapters
            .slice(0, 2)
            .map((chapter) => `- ${chapter.title}\n  摘要：${chapter.summary}`)
            .join('\n') || '暂无近期章节上下文。';

        const modeInstruction = this.getModeInstruction(request.mode, snapshot);
        const outputInstruction = request.mode === 'summarize'
            ? '输出 3-6 条简洁要点，可使用 Markdown 列表；不要解释你的做法。'
            : '只输出可直接写入小说文档的正文片段；不要输出标题、front matter、解释、分析、思考、提示词复述、代码块。';

        const userPrompt = [
            `任务模式：${this.getModeLabel(request.mode)}`,
            `用户补充要求：${request.prompt.trim() || '无额外要求，请以当前上下文自然完成。'}`,
            '',
            '当前文档（优先上下文）：',
            `- 文件名：${snapshot.fileName}`,
            `- 章节标题：${snapshot.chapterTitle}`,
            `- 当前段落：${snapshot.currentParagraph || '（未定位到当前段落）'}`,
            '',
            '光标前内容（截断）：',
            snapshot.beforeCursor || '（无）',
            '',
            '光标后内容（截断）：',
            snapshot.afterCursor || '（无）',
            '',
            '当前选中文本：',
            snapshot.selectionText || '（无选区）',
            '',
            '当前文档摘要（截断）：',
            snapshot.documentExcerpt || '（文档为空）',
            '',
            '次级项目上下文（辅助参考，不要喧宾夺主）：',
            '【大纲】',
            secondaryOutline,
            '',
            '【人物】',
            characters,
            '',
            '【近期章节】',
            recentChapters,
            '',
            '执行要求：',
            `1. ${modeInstruction}`,
            `2. ${outputInstruction}`,
            '3. 保持当前人称、时态、文风和叙事连续性。',
            '4. 如果信息不足，优先保守续写，不要自造重大设定。',
            '5. 可见输出只能是最终正文或最终摘要，严禁出现 thinking、分析、理由、提示词回显、说明话术。'
        ].join('\n');

        return {
            systemPrompt: [
                '你是 Noveler 内嵌的中文小说手写辅助助手。',
                '你的回答必须是最终可落盘内容，不得暴露任何思考过程。',
                '严禁输出 chain-of-thought、thinking、analysis、解释说明、提示词复述、元注释、标题、front matter、代码块。',
                '如果你有内部思考，必须完全隐藏；可见输出中只能出现最终正文或最终摘要。'
            ].join('\n'),
            userPrompt
        };
    }

    private getModeInstruction(mode: WritingAssistantMode, snapshot: ActiveEditorSnapshot): string {
        switch (mode) {
            case 'continue':
                return '在当前光标处无缝续写 1-3 段，重点承接上文并兼顾下文衔接。';
            case 'rewrite':
                return snapshot.selectionText
                    ? '重写选中文本，保留核心事实与剧情意图，优化表达和节奏。'
                    : '重写当前段落，保留核心事实与剧情意图，优化表达和节奏。';
            case 'expand':
                return snapshot.selectionText
                    ? '扩写选中文本，补足细节、动作、环境或心理，但不要偏题。'
                    : '扩写当前段落，补足细节、动作、环境或心理，但不要偏题。';
            case 'polishDialogue':
                return snapshot.selectionText
                    ? '优先润色选中的对话，让台词更自然、更有张力，并尽量少改非对话内容。'
                    : '围绕当前段落中的对话进行润色，让台词更自然、更有张力。';
            case 'summarize':
                return '总结当前章节的关键信息，便于作者回看和后续写作。';
        }
    }

    private getModeLabel(mode: WritingAssistantMode): string {
        switch (mode) {
            case 'continue':
                return '续写当前内容';
            case 'rewrite':
                return '改写选区/段落';
            case 'expand':
                return '扩写选区/段落';
            case 'polishDialogue':
                return '润色对话';
            case 'summarize':
                return '总结当前章节';
        }
    }

    private captureActiveEditor(editor: vscode.TextEditor): ActiveEditorSnapshot {
        const document = editor.document;
        const selection = editor.selection;
        const selectionText = document.getText(selection);
        const paragraph = this.getCurrentParagraph(document, selection.active);
        const beforeRange = new vscode.Range(
            document.positionAt(Math.max(0, document.offsetAt(selection.active) - 1800)),
            selection.active
        );
        const afterRange = new vscode.Range(
            selection.active,
            document.positionAt(Math.min(document.getText().length, document.offsetAt(selection.active) + 600))
        );
        const documentText = document.getText();

        return {
            documentUri: document.uri.toString(),
            fileName: path.basename(document.fileName),
            chapterTitle: path.basename(document.fileName, path.extname(document.fileName)),
            hasSelection: !selection.isEmpty,
            selectionText: selectionText.trim(),
            selectionRange: selection.isEmpty ? undefined : new vscode.Range(selection.start, selection.end),
            currentParagraph: paragraph?.text || '',
            currentParagraphRange: paragraph?.range,
            beforeCursor: document.getText(beforeRange).trim(),
            afterCursor: document.getText(afterRange).trim(),
            documentExcerpt: documentText.slice(0, 2500).trim()
        };
    }

    private getCurrentParagraph(document: vscode.TextDocument, position: vscode.Position): { text: string; range: vscode.Range } | undefined {
        const lines = document.getText().split(/\r?\n/);
        if (lines.length === 0) {
            return undefined;
        }

        let startLine = position.line;
        let endLine = position.line;

        while (startLine > 0 && lines[startLine].trim() !== '' && !lines[startLine - 1].startsWith('#') && lines[startLine - 1].trim() !== '') {
            startLine--;
        }

        while (endLine < lines.length - 1 && lines[endLine].trim() !== '' && lines[endLine + 1].trim() !== '') {
            endLine++;
        }

        const range = new vscode.Range(
            new vscode.Position(startLine, 0),
            new vscode.Position(endLine, lines[endLine].length)
        );

        return {
            text: document.getText(range).trim(),
            range
        };
    }

    private resolveSourceRange(
        mode: WritingAssistantMode,
        target: WritingAssistantTarget,
        snapshot: ActiveEditorSnapshot
    ): vscode.Range | undefined {
        if (target !== 'replace') {
            return undefined;
        }

        if (snapshot.selectionRange) {
            return snapshot.selectionRange;
        }

        if (mode === 'rewrite' || mode === 'expand' || mode === 'polishDialogue') {
            return snapshot.currentParagraphRange;
        }

        return undefined;
    }
}
