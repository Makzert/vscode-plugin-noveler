import * as vscode from 'vscode';
import { ConfigService } from '../services/configService';

export async function ensureAIConfigurationReady(): Promise<boolean> {
    const configService = ConfigService.getInstance();
    await configService.waitForConfig();

    const aiConfig = configService.getAIConfig();
    if (aiConfig.apiKey && aiConfig.baseUrl && aiConfig.model) {
        return true;
    }

    const choice = await vscode.window.showWarningMessage(
        'AI 配置不完整，请先在 novel.jsonc 的 noveler.ai 中配置 apiKey、baseUrl 和 model。',
        '打开配置',
        '取消'
    );

    if (choice === '打开配置') {
        await vscode.commands.executeCommand('noveler.openConfig');
    }

    return false;
}

export function formatAIError(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}
