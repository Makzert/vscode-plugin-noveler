import * as vscode from 'vscode';
import { DRAFTS_FOLDER } from '../constants';
import { AgentOrchestrator } from '../mcp/AgentOrchestrator';
import { createChapter } from './createChapter';
import { ensureAIConfigurationReady, formatAIError } from './aiCommandHelper';

export async function generateChapterDraftCommand(orchestrator: AgentOrchestrator): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showWarningMessage('请先打开一个工作区');
        return;
    }

    if (!(await ensureAIConfigurationReady())) {
        return;
    }

    const chapterTitle = await vscode.window.showInputBox({
        prompt: '输入要生成的章节标题',
        placeHolder: '例如：边城初战'
    });

    if (!chapterTitle) {
        return;
    }

    const outlineText = await pickOutlineText(workspaceFolder.uri);
    if (!outlineText) {
        vscode.window.showWarningMessage('未找到可用的大纲文件，请先在 drafts/ 中创建大纲');
        return;
    }

    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Noveler AI 正在生成章节草稿',
            cancellable: false
        }, async () => {
            const draft = await orchestrator.createChapterDraft(outlineText, chapterTitle);
            await createChapter(chapterTitle, {
                bodyContent: `\n${draft.trim()}\n`
            });
            vscode.window.showInformationMessage('AI 章节草稿已按项目规范写入 chapters/');
        });
    } catch (error) {
        vscode.window.showErrorMessage(`AI 章节草稿生成失败: ${formatAIError(error)}`);
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
                placeHolder: '选择用于生成章节草稿的大纲文件',
                ignoreFocusOut: true
            });
        }

        if (!selected) {
            return undefined;
        }

        const outlineUri = vscode.Uri.joinPath(draftsUri, selected);
        const content = await vscode.workspace.fs.readFile(outlineUri);
        return Buffer.from(content).toString('utf8');
    } catch {
        return undefined;
    }
}
