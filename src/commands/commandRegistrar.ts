/**
 * 命令注册模块
 * 将所有命令注册逻辑集中管理
 */

import * as vscode from 'vscode';
import { ChineseNovelFormatProvider } from '../providers/formatProvider';
import { WordCountService } from '../services/wordCountService';
import { ConfigService } from '../services/configService';
import { FocusModeService } from '../services/focusModeService';
import { SensitiveWordService } from '../services/sensitiveWordService';
import { SensitiveWordDiagnosticProvider } from '../providers/sensitiveWordDiagnostic';
import { NovelerViewProvider } from '../views/novelerViewProvider';
import { StatsWebviewProvider } from '../views/statsWebviewProvider';
import { WelcomeWebviewProvider } from '../views/welcomeWebviewProvider';
import { PreviewWebviewProvider } from '../views/previewWebviewProvider';
import { AIAssistantViewProvider } from '../views/aiAssistantViewProvider';
import { handleReadmeAutoUpdate } from '../utils/readmeAutoUpdate';
import { initProject } from './initProject';
import { createChapter } from './createChapter';
import { createCharacter } from './createCharacter';
import { createVolume } from './createVolume';
import { openSensitiveWordsConfig } from './openSensitiveWordsConfigCommand';
import { addToCustomWords, addToWhitelist } from './addToSensitiveWordsCommand';
import { generateRandomName } from './generateName';
import { quickSettings } from './quickSettings';
import { CONFIG_FILE_NAME } from '../constants';
import {
    renameChapter,
    markChapterCompleted,
    markChapterInProgress,
    updateChapterStatusWithDialog,
    deleteChapter,
    renameCharacter,
    deleteCharacter
} from './contextMenuCommands';
import {
    renameVolume,
    deleteVolume,
    editVolumeProperties,
    createChapterInVolume,
    moveChapterToVolume,
    copyChapterToVolume,
    openVolumeOutline
} from './volumeCommands';
import { migrateToVolumeStructure, rollbackToFlatStructure } from './migrationWizard';
import { jumpToReadmeSection } from './jumpToReadme';
import { handleError, ErrorSeverity } from '../utils/errorHandler';
import { Logger } from '../utils/logger';
import { NovelHighlightProvider } from '../providers/highlightProvider';
import { chooseMatchAtCursor } from './matchSelectionCommand';
import { LLMClient } from '../ai/LLMClient';
import { AgentOrchestrator } from '../mcp/AgentOrchestrator';
import { runAITestCommand } from './aiTestCommand';
import { generateOutlineCommand } from './generateOutlineCommand';
import { generateChapterDraftCommand } from './generateChapterDraftCommand';
import { CharacterSyncService } from '../services/characterSyncService';

/**
 * 命令注册器依赖项
 */
export interface CommandRegistrarDeps {
    context: vscode.ExtensionContext;
    wordCountService: WordCountService;
    configService: ConfigService;
    focusModeService: FocusModeService;
    sensitiveWordService: SensitiveWordService;
    sensitiveWordDiagnostic: SensitiveWordDiagnosticProvider;
    novelerViewProvider: NovelerViewProvider;
    statsWebviewProvider: StatsWebviewProvider;
    welcomeWebviewProvider: WelcomeWebviewProvider;
    previewWebviewProvider: PreviewWebviewProvider;
    aiAssistantViewProvider: AIAssistantViewProvider;
    highlightProvider: NovelHighlightProvider;
    updateHighlights: (editor: vscode.TextEditor | undefined) => void;
    llmClient: LLMClient;
    agentOrchestrator: AgentOrchestrator;
    characterSyncService: CharacterSyncService;
}

/**
 * 注册所有命令
 */
export function registerAllCommands(deps: CommandRegistrarDeps): void {
    registerCoreCommands(deps);
    registerChapterCommands(deps);
    registerCharacterCommands(deps);
    registerVolumeCommands(deps);
    registerSensitiveWordCommands(deps);
    registerMigrationCommands(deps);
    registerAICommands(deps);
    registerUtilityCommands(deps);
}

/**
 * 注册核心命令
 */
function registerCoreCommands(deps: CommandRegistrarDeps): void {
    const { context, novelerViewProvider, statsWebviewProvider, welcomeWebviewProvider, previewWebviewProvider, focusModeService } = deps;

    // 刷新命令
    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.refresh', async () => {
            novelerViewProvider.refresh();
            await handleReadmeAutoUpdate();
        })
    );

    // 显示统计面板
    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.showStats', async () => {
            await statsWebviewProvider.show();
        })
    );

    // 显示欢迎页面
    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.showWelcome', async () => {
            await welcomeWebviewProvider.show(false);
        })
    );

    // 显示手机预览
    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.showPreview', async () => {
            await previewWebviewProvider.show();
        })
    );

    // 初始化项目
    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.initProject', async () => {
            await initProject(context);
        })
    );

    // 切换专注模式
    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.toggleFocusMode', async () => {
            await focusModeService.toggle();
        })
    );

    // 打开配置文件
    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.openConfig', async () => {
            await openConfigFile(context);
        })
    );

    // 更新 README（向后兼容）
    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.updateReadme', async () => {
            await vscode.commands.executeCommand('noveler.refresh');
        })
    );
}

/**
 * 注册章节相关命令
 */
function registerChapterCommands(deps: CommandRegistrarDeps): void {
    const { context } = deps;

    // 创建章节
    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.createChapter', async () => {
            const chapterName = await vscode.window.showInputBox({
                prompt: '只输入章节名称（不需要输入"第几章"）',
                placeHolder: '例如：陨落的天才'
            });

            if (chapterName) {
                await createChapter(chapterName);
            }
        })
    );

    // 章节右键菜单命令
    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.renameChapter', renameChapter)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.markChapterCompleted', markChapterCompleted)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.markChapterInProgress', markChapterInProgress)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.updateChapterStatus', updateChapterStatusWithDialog)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.deleteChapter', deleteChapter)
    );
}

/**
 * 注册人物相关命令
 */
function registerCharacterCommands(deps: CommandRegistrarDeps): void {
    const { context } = deps;

    // 创建人物
    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.createCharacter', async () => {
            const characterName = await vscode.window.showInputBox({
                prompt: '请输入人物名称',
                placeHolder: '例如：萧炎'
            });

            if (characterName) {
                await createCharacter(characterName);
            }
        })
    );

    // 随机起名
    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.generateRandomName', async () => {
            await generateRandomName();
        })
    );

    // 人物右键菜单命令
    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.renameCharacter', renameCharacter)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.deleteCharacter', deleteCharacter)
    );
}

/**
 * 注册分卷相关命令
 */
function registerVolumeCommands(deps: CommandRegistrarDeps): void {
    const { context } = deps;

    // 创建卷
    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.createVolume', async () => {
            await createVolume();
        })
    );

    // 卷右键菜单命令
    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.renameVolume', renameVolume)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.deleteVolume', deleteVolume)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.editVolumeProperties', editVolumeProperties)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.createChapterInVolume', createChapterInVolume)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.moveChapterToVolume', moveChapterToVolume)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.copyChapterToVolume', copyChapterToVolume)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.openVolumeOutline', openVolumeOutline)
    );
}

/**
 * 注册敏感词相关命令
 */
function registerSensitiveWordCommands(deps: CommandRegistrarDeps): void {
    const { context, sensitiveWordDiagnostic } = deps;

    // 打开敏感词配置
    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.openSensitiveWordsConfig', async () => {
            await openSensitiveWordsConfig();
        })
    );

    // 添加到自定义词库
    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.addToCustomWords', addToCustomWords)
    );

    // 添加选中文本到白名单
    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.addSelectedToWhitelist', addToWhitelist)
    );

    // 重新加载敏感词库
    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.reloadSensitiveWords', async () => {
            try {
                const sensitiveWordService = SensitiveWordService.getInstance();
                await sensitiveWordService.reload();
                vscode.window.showInformationMessage('敏感词库已重新加载');
            } catch (error) {
                handleError('重新加载敏感词库失败', error, ErrorSeverity.Error);
            }
        })
    );

    // 添加到白名单
    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.addToWhitelist', async (word: string) => {
            try {
                const sensitiveWordService = SensitiveWordService.getInstance();
                await addWordToWhitelistSimple(word, sensitiveWordService);
            } catch (error) {
                handleError('添加到白名单失败', error, ErrorSeverity.Error);
            }
        })
    );

    // 忽略敏感词（会话级别）
    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.ignoreSensitiveWord', (documentUri: string, word: string) => {
            if (sensitiveWordDiagnostic && documentUri && word) {
                sensitiveWordDiagnostic.ignoreWordInDocument(documentUri, word);
                // 刷新当前文档的诊断
                const editor = vscode.window.activeTextEditor;
                if (editor && editor.document.uri.toString() === documentUri) {
                    sensitiveWordDiagnostic.updateDiagnostics(editor.document);
                }
            }
        })
    );

    // 显示敏感词详情
    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.showSensitiveWordDetails', () => {
            vscode.commands.executeCommand('workbench.actions.view.problems');
        })
    );
}

/**
 * 注册迁移相关命令
 */
function registerMigrationCommands(deps: CommandRegistrarDeps): void {
    const { context } = deps;

    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.migrateToVolumeStructure', migrateToVolumeStructure)
    );
    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.rollbackToFlatStructure', rollbackToFlatStructure)
    );
}

/**
 * 注册 AI 相关命令
 */
function registerAICommands(deps: CommandRegistrarDeps): void {
    const { context, llmClient, agentOrchestrator, aiAssistantViewProvider, characterSyncService } = deps;

    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.ai.test', async () => {
            await runAITestCommand(llmClient);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.generate.outline', async () => {
            await generateOutlineCommand(agentOrchestrator);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.generate.chapterDraft', async () => {
            await generateChapterDraftCommand(agentOrchestrator);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.openAIAssistant', async () => {
            await aiAssistantViewProvider.reveal();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.ai.generateFromEditor', async () => {
            await aiAssistantViewProvider.generateFromEditor();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.ai.applyInsert', async () => {
            await aiAssistantViewProvider.applyLastResultToEditor('insert');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.ai.applyReplace', async () => {
            await aiAssistantViewProvider.applyLastResultToEditor('replace');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.ai.applyAppend', async () => {
            await aiAssistantViewProvider.applyLastResultToEditor('append');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.ai.setPromptFromSelection', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.selection.isEmpty) {
                vscode.window.showWarningMessage('请先在编辑器中选中一段文字，作为 AI 补充要求。');
                return;
            }

            const prompt = editor.document.getText(editor.selection).trim();
            await aiAssistantViewProvider.setPrompt(prompt);
            vscode.window.showInformationMessage('已将选中文本设为 AI 补充要求。');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.ai.clearPrompt', async () => {
            await aiAssistantViewProvider.clearPrompt();
            vscode.window.showInformationMessage('已清空 AI 补充要求。');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.ai.cycleMode', async () => {
            const nextMode = await aiAssistantViewProvider.cycleMode();
            const labels: Record<string, string> = {
                continue: '续写当前内容',
                rewrite: '改写选区/段落',
                expand: '扩写选区/段落',
                polishDialogue: '润色对话',
                summarize: '总结当前章节'
            };
            vscode.window.showInformationMessage(`AI 模式已切换为：${labels[nextMode]}`);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.ai.cycleTarget', async () => {
            const nextTarget = await aiAssistantViewProvider.cycleTarget();
            const labels: Record<string, string> = {
                insert: '插入光标处',
                replace: '替换选区/段落',
                append: '追加到文末'
            };
            vscode.window.showInformationMessage(`AI 应用目标已切换为：${labels[nextTarget]}`);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.ai.discardPreview', async () => {
            await aiAssistantViewProvider.discardPreview();
            vscode.window.showInformationMessage('已丢弃当前 AI 预览。');
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.ai.showDiff', async () => {
            await aiAssistantViewProvider.showDiffPreview();
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.ai.syncCharactersCurrentChapter', async () => {
            const editor = vscode.window.activeTextEditor;
            if (!editor || editor.document.languageId !== 'markdown' || !editor.document.uri.fsPath.includes('/chapters/')) {
                vscode.window.showWarningMessage('请先打开 chapters/ 下的章节 Markdown 文件。');
                return;
            }

            const summary = await characterSyncService.syncDocument(editor.document);
            if (summary.chapterCharactersUpdated) {
                await editor.document.save();
            }

            const parts = [
                summary.chapterCharactersUpdated ? '已更新本章人物列表' : '',
                summary.createdCharacters.length > 0 ? `新增人物档案 ${summary.createdCharacters.length} 个` : '',
                summary.updatedCharacters.length > 0 ? `更新人物档案 ${summary.updatedCharacters.length} 个` : ''
            ].filter(Boolean);

            vscode.window.showInformationMessage(parts.length > 0 ? parts.join('，') : '未识别到需要同步的人物信息。');
        })
    );
}

/**
 * 注册实用工具命令
 */
function registerUtilityCommands(deps: CommandRegistrarDeps): void {
    const { context, highlightProvider, updateHighlights } = deps;

    // 格式化文档
    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.formatDocument', async () => {
            await formatCurrentDocument();
        })
    );

    // 重载高亮配置
    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.reloadHighlights', () => {
            highlightProvider.reloadDecorations();
            updateHighlights(vscode.window.activeTextEditor);
            Logger.info('高亮配置已重新加载');
        })
    );

    // 在冲突位置手动选择匹配项（跨类型：人物名/敏感词，仅影响当前位置）
    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.chooseMatchAtCursor', async () => {
            // extension 激活早期 registerAllCommands 可能传入了占位 null，这里兜底获取真实实例
            const safeSensitiveService = deps.sensitiveWordService
                ?? SensitiveWordService.getInstance();
            await chooseMatchAtCursor(highlightProvider, safeSensitiveService, deps.sensitiveWordDiagnostic);
        })
    );

    // 跳转到 README
    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.jumpToReadmeSection', jumpToReadmeSection)
    );

    // 快速设置
    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.quickSettings', async () => {
            await quickSettings();
        })
    );

    // 切换护眼模式
    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.toggleEyeCareMode', async () => {
            try {
                const configService = ConfigService.getInstance();
                const newEnabled = await configService.toggleEyeCareMode();
                vscode.window.showInformationMessage(
                    `护眼模式已${newEnabled ? '启用' : '禁用'}（仅当前项目生效）`
                );
            } catch (error) {
                handleError('切换护眼模式失败', error);
            }
        })
    );

    // 刷新护眼模式（重新应用颜色配置）
    context.subscriptions.push(
        vscode.commands.registerCommand('noveler.refreshEyeCareMode', async () => {
            try {
                const configService = ConfigService.getInstance();
                if (configService.isEyeCareModeEnabled()) {
                    await configService.toggleEyeCareMode(true);  // 强制重新应用
                    vscode.window.showInformationMessage('护眼模式已刷新');
                }
            } catch (error) {
                handleError('刷新护眼模式失败', error);
            }
        })
    );
}

/**
 * 打开配置文件
 */
async function openConfigFile(context: vscode.ExtensionContext): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showWarningMessage('未找到工作区文件夹');
        return;
    }

    const configUri = vscode.Uri.joinPath(workspaceFolder.uri, CONFIG_FILE_NAME);

    try {
        const document = await vscode.workspace.openTextDocument(configUri);
        await vscode.window.showTextDocument(document);
    } catch {
        const result = await vscode.window.showInformationMessage(
            'novel.jsonc 配置文件不存在，是否创建？',
            '创建', '取消'
        );

        if (result === '创建') {
            try {
                const templatePath = vscode.Uri.joinPath(
                    context.extensionUri,
                    'templates',
                    'default-config.jsonc'
                );
                const templateData = await vscode.workspace.fs.readFile(templatePath);

                await vscode.workspace.fs.writeFile(configUri, templateData);
                const document = await vscode.workspace.openTextDocument(configUri);
                await vscode.window.showTextDocument(document);
                vscode.window.showInformationMessage('已创建 novel.jsonc 配置文件');
            } catch (templateError) {
                handleError('创建配置文件失败', templateError, ErrorSeverity.Error);
            }
        }
    }
}

/**
 * 格式化当前文档
 */
async function formatCurrentDocument(): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showWarningMessage('没有打开的编辑器');
        return;
    }

    if (editor.document.languageId !== 'markdown') {
        vscode.window.showWarningMessage('只能格式化 Markdown 文档');
        return;
    }

    try {
        const formatProvider = new ChineseNovelFormatProvider();
        const edits = formatProvider.provideDocumentFormattingEdits(
            editor.document,
            {} as vscode.FormattingOptions,
            {} as vscode.CancellationToken
        );

        if (edits.length > 0) {
            const workspaceEdit = new vscode.WorkspaceEdit();
            workspaceEdit.set(editor.document.uri, edits);
            await vscode.workspace.applyEdit(workspaceEdit);
            vscode.window.showInformationMessage('文档格式化完成');
        } else {
            vscode.window.showInformationMessage('文档无需格式化');
        }
    } catch (error) {
        vscode.window.showErrorMessage(`格式化失败: ${error}`);
    }
}

/**
 * 添加词汇到白名单（简化版，不需要诊断提供器）
 */
async function addWordToWhitelistSimple(
    word: string,
    sensitiveWordService: SensitiveWordService
): Promise<void> {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage('请先打开一个工作区');
        return;
    }

    const whitelistDirUri = vscode.Uri.joinPath(workspaceFolder.uri, '.noveler', 'sensitive-words');
    const whitelistUri = vscode.Uri.joinPath(whitelistDirUri, 'whitelist.jsonc');

    // 确保目录存在
    try {
        await vscode.workspace.fs.stat(whitelistDirUri);
    } catch {
        await vscode.workspace.fs.createDirectory(whitelistDirUri);
    }

    // 读取或创建白名单文件
    interface WhitelistFile {
        description: string;
        words: string[];
    }

    let whitelist: WhitelistFile;
    try {
        const content = await vscode.workspace.fs.readFile(whitelistUri);
        whitelist = JSON.parse(Buffer.from(content).toString('utf8'));
    } catch {
        whitelist = {
            description: '用户自定义白名单',
            words: []
        };
    }

    if (whitelist.words.includes(word)) {
        vscode.window.showInformationMessage(`"${word}" 已在白名单中`);
        return;
    }

    whitelist.words.push(word);

    const encoder = new TextEncoder();
    await vscode.workspace.fs.writeFile(whitelistUri, encoder.encode(JSON.stringify(whitelist, null, 2)));

    await sensitiveWordService.reload();

    vscode.window.showInformationMessage(`已将 "${word}" 添加到白名单`);
}
