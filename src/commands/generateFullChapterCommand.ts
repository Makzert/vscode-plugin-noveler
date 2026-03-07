import * as path from 'path';
import * as vscode from 'vscode';
import { DRAFTS_FOLDER } from '../constants';
import { FullChapterResult, AgentOrchestrator } from '../mcp/AgentOrchestrator';
import { createChapter } from './createChapter';
import { ensureAIConfigurationReady, formatAIError } from './aiCommandHelper';

const HISTORY_FOLDER = 'history';

export async function generateFullChapterCommand(orchestrator: AgentOrchestrator): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showWarningMessage('请先打开一个工作区');
        return;
    }

    if (!(await ensureAIConfigurationReady())) {
        return;
    }

    const chapterTitle = await vscode.window.showInputBox({
        prompt: '输入要全流程生成的章节标题',
        placeHolder: '例如：边城初战'
    });
    if (!chapterTitle?.trim()) {
        return;
    }

    const outlineText = await pickOutlineText(workspaceFolder.uri);
    if (!outlineText?.trim()) {
        vscode.window.showWarningMessage('未找到可用的大纲文件，请先在 drafts/ 中准备大纲。');
        return;
    }

    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Noveler AI 正在执行全流程章节生成',
            cancellable: false
        }, async () => {
            const result = await orchestrator.generateFullChapter({
                outline: outlineText,
                chapterTitle: chapterTitle.trim(),
                candidateCount: 3,
                rewriteMode: 'unifyStyle'
            });

            await createChapter(chapterTitle.trim(), {
                bodyContent: `\n${result.finalDraft.trim()}\n`
            });

            await writeHistoryArtifacts(workspaceFolder.uri, chapterTitle.trim(), result);

            vscode.window.showInformationMessage(
                `全流程生成完成：已写入 chapters/，并在 history/ 保存 ${Math.max(0, result.candidates.length - 1)} 份候选。`
            );
        });
    } catch (error) {
        vscode.window.showErrorMessage(`全流程章节生成失败: ${formatAIError(error)}`);
    }
}

async function pickOutlineText(workspaceUri: vscode.Uri): Promise<string | undefined> {
    const draftsUri = vscode.Uri.joinPath(workspaceUri, DRAFTS_FOLDER);
    try {
        const entries = await vscode.workspace.fs.readDirectory(draftsUri);
        const outlineFiles = entries
            .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.md'))
            .map(([name]) => name);
        if (outlineFiles.length === 0) {
            return undefined;
        }

        let selected = outlineFiles.find((name) => name === '大纲.md');
        if (!selected) {
            selected = await vscode.window.showQuickPick(outlineFiles, {
                placeHolder: '选择用于全流程章节生成的大纲文件',
                ignoreFocusOut: true
            });
        }
        if (!selected) {
            return undefined;
        }

        const outlineUri = vscode.Uri.joinPath(draftsUri, selected);
        const bytes = await vscode.workspace.fs.readFile(outlineUri);
        return Buffer.from(bytes).toString('utf8');
    } catch {
        return undefined;
    }
}

async function writeHistoryArtifacts(
    workspaceUri: vscode.Uri,
    chapterTitle: string,
    result: FullChapterResult
): Promise<void> {
    const historyUri = vscode.Uri.joinPath(workspaceUri, HISTORY_FOLDER);
    await ensureDirectory(historyUri);

    const timestamp = formatTimestamp(new Date());
    const safeTitle = sanitizeFileSegment(chapterTitle);

    for (let index = 0; index < result.candidates.length; index++) {
        if (index === result.bestIndex) {
            continue;
        }

        const fileUri = vscode.Uri.joinPath(
            historyUri,
            `${timestamp}-${safeTitle}-candidate-${index + 1}.md`
        );
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(result.candidates[index], 'utf8'));
    }

    const report = {
        chapterTitle: result.chapterTitle,
        bestIndex: result.bestIndex,
        scores: result.evaluation.scores,
        rewritten: result.rewritten
    };
    const reportUri = vscode.Uri.joinPath(historyUri, `${timestamp}-${safeTitle}-scores.json`);
    await vscode.workspace.fs.writeFile(reportUri, Buffer.from(JSON.stringify(report, null, 2), 'utf8'));
}

async function ensureDirectory(uri: vscode.Uri): Promise<void> {
    try {
        await vscode.workspace.fs.stat(uri);
    } catch {
        await vscode.workspace.fs.createDirectory(uri);
    }
}

function sanitizeFileSegment(value: string): string {
    const base = path.basename(value);
    const safe = base.replace(/[\\/:*?"<>|]/g, '-').trim();
    return safe.length > 0 ? safe : 'chapter';
}

function formatTimestamp(date: Date): string {
    const yyyy = date.getFullYear();
    const mm = String(date.getMonth() + 1).padStart(2, '0');
    const dd = String(date.getDate()).padStart(2, '0');
    const hh = String(date.getHours()).padStart(2, '0');
    const mi = String(date.getMinutes()).padStart(2, '0');
    const ss = String(date.getSeconds()).padStart(2, '0');
    return `${yyyy}${mm}${dd}-${hh}${mi}${ss}`;
}
