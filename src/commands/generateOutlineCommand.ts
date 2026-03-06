import * as vscode from 'vscode';
import { DRAFTS_FOLDER } from '../constants';
import { AgentOrchestrator } from '../mcp/AgentOrchestrator';
import { ensureAIConfigurationReady, formatAIError } from './aiCommandHelper';

export async function generateOutlineCommand(orchestrator: AgentOrchestrator): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showWarningMessage('请先打开一个工作区');
        return;
    }

    if (!(await ensureAIConfigurationReady())) {
        return;
    }

    const topic = await vscode.window.showInputBox({
        prompt: '输入小说主题或一句话设定',
        placeHolder: '例如：一个被逐出宗门的天才，在边陲小城重建自己的势力'
    });

    if (!topic) {
        return;
    }

    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Noveler AI 正在生成大纲',
            cancellable: false
        }, async () => {
            const outline = await orchestrator.createOutline(topic);
            const draftsUri = vscode.Uri.joinPath(workspaceFolder.uri, DRAFTS_FOLDER);
            await ensureDirectory(draftsUri);

            const outlineUri = vscode.Uri.joinPath(draftsUri, '大纲.md');
            await vscode.workspace.fs.writeFile(outlineUri, Buffer.from(outline, 'utf8'));

            const document = await vscode.workspace.openTextDocument(outlineUri);
            await vscode.window.showTextDocument(document);
            vscode.window.showInformationMessage('AI 大纲已生成到 drafts/大纲.md');
        });
    } catch (error) {
        vscode.window.showErrorMessage(`AI 大纲生成失败: ${formatAIError(error)}`);
    }
}

async function ensureDirectory(uri: vscode.Uri): Promise<void> {
    try {
        await vscode.workspace.fs.stat(uri);
    } catch {
        await vscode.workspace.fs.createDirectory(uri);
    }
}
