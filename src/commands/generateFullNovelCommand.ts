import * as vscode from 'vscode';
import { DRAFTS_FOLDER } from '../constants';
import { LLMClient } from '../ai/LLMClient';
import { AgentOrchestrator } from '../mcp/AgentOrchestrator';
import { createChapter } from './createChapter';
import { ensureAIConfigurationReady, formatAIError } from './aiCommandHelper';

interface NovelChapterPlanItem {
    index: number;
    title: string;
    summary: string;
}

interface NovelChapterPlan {
    bookTitle: string;
    genre: string;
    targetAudience: string;
    overallOutline: string;
    chapterPlans: NovelChapterPlanItem[];
}

export async function generateFullNovelCommand(
    llmClient: LLMClient,
    orchestrator: AgentOrchestrator
): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showWarningMessage('请先打开一个工作区');
        return;
    }

    if (!(await ensureAIConfigurationReady())) {
        return;
    }

    const bookTitle = await vscode.window.showInputBox({
        prompt: '输入小说标题',
        placeHolder: '例如：边城雷火录'
    });
    if (!bookTitle?.trim()) {
        return;
    }

    const bookSummary = await vscode.window.showInputBox({
        prompt: '输入小说摘要（核心设定、主线冲突、目标读者）',
        placeHolder: '例如：被逐出宗门的少年在边城崛起，卷入三大势力战争...'
    });
    if (!bookSummary?.trim()) {
        return;
    }

    const chapterCountInput = await vscode.window.showInputBox({
        prompt: '输入目标章节数（建议 10-30）',
        placeHolder: '20',
        value: '20'
    });
    const parsedChapterCount = Number(chapterCountInput);
    const chapterCount = Number.isFinite(parsedChapterCount)
        ? Math.max(3, Math.min(60, Math.floor(parsedChapterCount)))
        : 20;

    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Noveler AI 正在执行全自动小说生成',
            cancellable: false
        }, async (progress) => {
            progress.report({ increment: 1, message: '生成全书大纲与章节计划...' });

            const plan = await buildNovelPlan(llmClient, bookTitle.trim(), bookSummary.trim(), chapterCount);
            await writePlanArtifacts(workspaceFolder.uri, plan);

            const total = plan.chapterPlans.length;
            const failed: string[] = [];
            for (let i = 0; i < total; i++) {
                const chapter = plan.chapterPlans[i];
                const chapterTitle = chapter.title.trim() || `第${chapter.index}章`;
                const chapterOutline = [
                    `小说标题：${plan.bookTitle}`,
                    `作品定位：${plan.genre}｜${plan.targetAudience}`,
                    '',
                    '全书主线大纲：',
                    plan.overallOutline,
                    '',
                    `当前章节：第${chapter.index}章 ${chapterTitle}`,
                    '本章摘要：',
                    chapter.summary
                ].join('\n');

                progress.report({
                    increment: 99 / Math.max(total, 1),
                    message: `生成章节 (${i + 1}/${total})：${chapterTitle}`
                });

                try {
                    const result = await orchestrator.generateFullChapter({
                        outline: chapterOutline,
                        chapterTitle,
                        candidateCount: 3,
                        rewriteMode: 'unifyStyle'
                    });

                    await createChapter(chapterTitle, {
                        bodyContent: `\n${result.finalDraft.trim()}\n`
                    });
                } catch (error) {
                    failed.push(`第${chapter.index}章 ${chapterTitle}: ${formatAIError(error)}`);
                }
            }

            const ok = total - failed.length;
            if (failed.length === 0) {
                vscode.window.showInformationMessage(`全自动生成完成：共 ${ok} 章，已写入 chapters/。`);
                return;
            }

            const reportUri = vscode.Uri.joinPath(workspaceFolder.uri, 'history', 'full-novel-failures.log');
            await ensureDirectory(vscode.Uri.joinPath(workspaceFolder.uri, 'history'));
            await vscode.workspace.fs.writeFile(reportUri, Buffer.from(failed.join('\n'), 'utf8'));
            vscode.window.showWarningMessage(
                `全自动生成完成：成功 ${ok} 章，失败 ${failed.length} 章。失败详情见 history/full-novel-failures.log`
            );
        });
    } catch (error) {
        vscode.window.showErrorMessage(`全自动小说生成失败: ${formatAIError(error)}`);
    }
}

async function buildNovelPlan(
    llmClient: LLMClient,
    bookTitle: string,
    summary: string,
    chapterCount: number
): Promise<NovelChapterPlan> {
    const prompt = [
        '你是长篇网文总编，目标是输出“可连续阅读、可直接发布”的全书执行计划。',
        '',
        `书名：${bookTitle}`,
        `摘要：${summary}`,
        `目标章节数：${chapterCount}`,
        '',
        '必须遵守：',
        '1. 主角动机、能力成长、关系变化必须连续，不得断层。',
        '2. 章节节奏要有起伏，不要每章重复同一冲突模板。',
        '3. 禁止输出解释和注释，只输出 JSON。',
        '',
        'JSON Schema：',
        '{',
        '  "bookTitle": "string",',
        '  "genre": "string",',
        '  "targetAudience": "string",',
        '  "overallOutline": "string, 800字内",',
        '  "chapterPlans": [',
        '    {',
        '      "index": 1,',
        '      "title": "string",',
        '      "summary": "string, 120-220字"',
        '    }',
        '  ]',
        '}',
        '',
        `硬性要求：chapterPlans 必须正好 ${chapterCount} 项，index 从 1 到 ${chapterCount} 连续。`
    ].join('\n');

    const raw = await llmClient.generate(prompt, {
        systemPrompt: '你是严谨的小说策划编辑，只返回合法 JSON，不得输出 markdown 代码块。',
        temperature: 0.4,
        timeoutMs: 240000
    });

    const parsed = parseModelJson<NovelChapterPlan>(raw);
    if (!parsed || !Array.isArray(parsed.chapterPlans)) {
        throw new Error('模型未返回有效的章节计划 JSON');
    }

    const normalizedPlans = parsed.chapterPlans
        .filter((item) => item && typeof item.title === 'string' && typeof item.summary === 'string')
        .map((item, idx) => ({
            index: Number.isFinite(item.index) ? Math.floor(item.index) : idx + 1,
            title: item.title.trim(),
            summary: item.summary.trim()
        }))
        .slice(0, chapterCount);

    if (normalizedPlans.length === 0) {
        throw new Error('章节计划为空');
    }

    while (normalizedPlans.length < chapterCount) {
        const idx = normalizedPlans.length + 1;
        normalizedPlans.push({
            index: idx,
            title: `第${idx}章`,
            summary: `承接上一章推进主线，在本章完成关键冲突与信息揭示（补位章节 ${idx}）。`
        });
    }

    for (let i = 0; i < normalizedPlans.length; i++) {
        normalizedPlans[i].index = i + 1;
    }

    return {
        bookTitle: parsed.bookTitle?.trim() || bookTitle,
        genre: parsed.genre?.trim() || '长篇小说',
        targetAudience: parsed.targetAudience?.trim() || '网络文学读者',
        overallOutline: parsed.overallOutline?.trim() || summary,
        chapterPlans: normalizedPlans
    };
}

function parseModelJson<T>(raw: string): T {
    const trimmed = raw.trim();
    try {
        return JSON.parse(trimmed) as T;
    } catch {
        // ignore and try fenced/object extraction
    }

    const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
    if (fenced) {
        try {
            return JSON.parse(fenced) as T;
        } catch {
            // ignore and try object extraction
        }
    }

    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
        const candidate = trimmed.slice(firstBrace, lastBrace + 1);
        return JSON.parse(candidate) as T;
    }

    throw new Error('无法解析模型返回的 JSON');
}

async function writePlanArtifacts(workspaceUri: vscode.Uri, plan: NovelChapterPlan): Promise<void> {
    const draftsUri = vscode.Uri.joinPath(workspaceUri, DRAFTS_FOLDER);
    await ensureDirectory(draftsUri);

    const outlineUri = vscode.Uri.joinPath(draftsUri, '大纲.md');
    const outlineText = [
        `# ${plan.bookTitle}`,
        '',
        `- 类型：${plan.genre}`,
        `- 目标读者：${plan.targetAudience}`,
        '',
        '## 全书主线',
        '',
        plan.overallOutline,
        '',
        '## 章节计划',
        '',
        ...plan.chapterPlans.map((item) => `- 第${item.index}章 ${item.title}：${item.summary}`)
    ].join('\n');
    await vscode.workspace.fs.writeFile(outlineUri, Buffer.from(outlineText, 'utf8'));

    const planUri = vscode.Uri.joinPath(draftsUri, '全书章节计划.json');
    await vscode.workspace.fs.writeFile(planUri, Buffer.from(JSON.stringify(plan, null, 2), 'utf8'));
}

async function ensureDirectory(uri: vscode.Uri): Promise<void> {
    try {
        await vscode.workspace.fs.stat(uri);
    } catch {
        await vscode.workspace.fs.createDirectory(uri);
    }
}
