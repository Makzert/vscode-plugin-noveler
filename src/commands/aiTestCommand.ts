import * as vscode from 'vscode';
import { LLMClient } from '../ai/LLMClient';
import { DRAFTS_FOLDER } from '../constants';
import { ensureAIConfigurationReady, formatAIError } from './aiCommandHelper';

export async function runAITestCommand(llmClient: LLMClient): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showWarningMessage('请先打开一个工作区');
        return;
    }

    if (!(await ensureAIConfigurationReady())) {
        return;
    }

    const prompt = await vscode.window.showInputBox({
        prompt: '输入要发送给 AI 的提示词',
        placeHolder: '例如：写一段仙侠小说的开篇场景'
    });

    if (!prompt) {
        return;
    }

    try {
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Noveler AI 正在生成测试结果',
            cancellable: false
        }, async () => {
            const content = await llmClient.generate(prompt, {
                systemPrompt: '你是 Noveler 内置 AI 测试助手，请用 Markdown 输出结果。',
                temperature: 0.7
            });

            const draftsUri = vscode.Uri.joinPath(workspaceFolder.uri, DRAFTS_FOLDER);
            await ensureDirectory(draftsUri);

            const fileUri = vscode.Uri.joinPath(draftsUri, `ai-test-${Date.now()}.md`);
            const fileContent = `# AI Test\n\n## Prompt\n\n${prompt}\n\n## Output\n\n${content}\n`;
            await vscode.workspace.fs.writeFile(fileUri, Buffer.from(fileContent, 'utf8'));

            const document = await vscode.workspace.openTextDocument(fileUri);
            await vscode.window.showTextDocument(document);
        });
    } catch (error) {
        vscode.window.showErrorMessage(`AI 测试生成失败: ${formatAIError(error)}`);
    }
}

async function ensureDirectory(uri: vscode.Uri): Promise<void> {
    try {
        await vscode.workspace.fs.stat(uri);
    } catch {
        await vscode.workspace.fs.createDirectory(uri);
    }
}
