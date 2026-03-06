import * as vscode from 'vscode';
import { ensureAIConfigurationReady, formatAIError } from '../commands/aiCommandHelper';
import {
    WritingAssistantMode,
    WritingAssistantResult,
    WritingAssistantService,
    WritingAssistantTarget
} from '../ai/WritingAssistantService';
import { CharacterSyncService } from '../services/characterSyncService';
import { AIInlinePreviewService } from '../services/aiInlinePreviewService';

const AI_ASSISTANT_STATE_KEY = 'noveler.aiAssistant.state';

interface PersistedAssistantState {
    mode: WritingAssistantMode;
    target: WritingAssistantTarget;
    prompt: string;
}

function resultSourceRange(
    target: WritingAssistantTarget,
    editor: vscode.TextEditor,
    existingRange?: vscode.Range
): vscode.Range | undefined {
    if (target !== 'replace') {
        return undefined;
    }

    if (existingRange) {
        return existingRange;
    }

    if (!editor.selection.isEmpty) {
        return new vscode.Range(editor.selection.start, editor.selection.end);
    }

    return undefined;
}

export class AIAssistantViewProvider implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView;
    private lastResult?: WritingAssistantResult;

    public constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly writingAssistantService: WritingAssistantService,
        private readonly characterSyncService: CharacterSyncService,
        private readonly inlinePreviewService: AIInlinePreviewService
    ) {}

    public resolveWebviewView(webviewView: vscode.WebviewView): void {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true
        };
        webviewView.webview.html = this.getHtmlContent(webviewView.webview);

        webviewView.webview.onDidReceiveMessage(
            async (message) => {
                switch (message.command) {
                    case 'ready':
                    case 'refreshContext':
                        await this.pushState();
                        break;
                    case 'generate':
                        await this.handleGenerate(message);
                        break;
                    case 'applyResult':
                        await this.applyResult(message.target as WritingAssistantTarget | undefined);
                        break;
                    case 'copyResult':
                        await this.copyResult();
                        break;
                    case 'discardPreview':
                        await this.discardPreview();
                        break;
                    case 'showDiff':
                        await this.showDiffPreview();
                        break;
                }
            },
            undefined,
            this.context.subscriptions
        );
    }

    public async reveal(): Promise<void> {
        await vscode.commands.executeCommand('workbench.view.extension.noveler');
        await vscode.commands.executeCommand('novelerAIView.focus');
        await this.pushState();
        await this.postMessage({ command: 'focusPrompt' });
    }

    public async generateFromEditor(): Promise<void> {
        const state = this.getPersistedState();
        await this.handleGenerate(state);
    }

    public async applyLastResultToEditor(target: WritingAssistantTarget): Promise<void> {
        await this.applyResult(target);
    }

    public async discardPreview(): Promise<void> {
        await this.inlinePreviewService.clear(vscode.window.activeTextEditor, true);
        this.lastResult = undefined;
        await this.postMessage({ command: 'previewDiscarded' });
    }

    public async showDiffPreview(): Promise<void> {
        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'markdown') {
            vscode.window.showWarningMessage('请先切回要写作的 Markdown 文档。');
            return;
        }

        const snapshot = this.inlinePreviewService.getSnapshot(editor);
        const originalText = snapshot?.originalText ?? '';
        const previewText = snapshot?.previewText || this.lastResult?.content || '';
        if (!previewText) {
            vscode.window.showWarningMessage('当前没有可对比的 AI 预览内容。');
            return;
        }

        const left = await vscode.workspace.openTextDocument({
            content: originalText || '（原位置为空）',
            language: 'markdown'
        });
        const right = await vscode.workspace.openTextDocument({
            content: previewText,
            language: 'markdown'
        });
        await vscode.commands.executeCommand('vscode.diff', left.uri, right.uri, 'AI 预览对比');
    }

    public async setPrompt(prompt: string): Promise<void> {
        const nextState = {
            ...this.getPersistedState(),
            prompt
        };
        await this.context.workspaceState.update(AI_ASSISTANT_STATE_KEY, nextState);
        await this.pushState();
    }

    public async clearPrompt(): Promise<void> {
        await this.setPrompt('');
    }

    public async cycleMode(): Promise<WritingAssistantMode> {
        const modes: WritingAssistantMode[] = ['continue', 'rewrite', 'expand', 'polishDialogue', 'summarize'];
        const current = this.getPersistedState();
        const nextMode = modes[(modes.indexOf(current.mode) + 1) % modes.length];
        await this.context.workspaceState.update(AI_ASSISTANT_STATE_KEY, {
            ...current,
            mode: nextMode
        });
        await this.pushState();
        return nextMode;
    }

    public async cycleTarget(): Promise<WritingAssistantTarget> {
        const targets: WritingAssistantTarget[] = ['insert', 'replace', 'append'];
        const current = this.getPersistedState();
        const nextTarget = targets[(targets.indexOf(current.target) + 1) % targets.length];
        await this.context.workspaceState.update(AI_ASSISTANT_STATE_KEY, {
            ...current,
            target: nextTarget
        });
        await this.pushState();
        return nextTarget;
    }

    public getStateSnapshot(): PersistedAssistantState {
        return this.getPersistedState();
    }

    public async refresh(): Promise<void> {
        await this.pushState();
    }

    private async handleGenerate(message: { mode?: WritingAssistantMode; target?: WritingAssistantTarget; prompt?: string }): Promise<void> {
        if (!(await ensureAIConfigurationReady())) {
            return;
        }

        const state: PersistedAssistantState = {
            mode: message.mode || 'continue',
            target: message.target || 'insert',
            prompt: typeof message.prompt === 'string' ? message.prompt : ''
        };
        await this.context.workspaceState.update(AI_ASSISTANT_STATE_KEY, state);

        await this.postMessage({
            command: 'setBusy',
            busy: true
        });

        try {
            const previewEditor = vscode.window.activeTextEditor;
            if (previewEditor && this.inlinePreviewService.hasActivePreview(previewEditor)) {
                await this.inlinePreviewService.clear(previewEditor, true);
            }
            const result = await this.writingAssistantService.generate({
                ...state,
                onPreviewChunk: async (content) => {
                    if (previewEditor && previewEditor.document.languageId === 'markdown') {
                        await this.inlinePreviewService.showStreaming(
                            previewEditor,
                            state.target,
                            content,
                            resultSourceRange(state.target, previewEditor, this.lastResult?.sourceRange)
                        );
                    }
                    await this.postMessage({
                        command: 'streamPreview',
                        content
                    });
                }
            });
            this.lastResult = result;
            if (previewEditor && previewEditor.document.languageId === 'markdown') {
                await this.inlinePreviewService.showStreaming(
                    previewEditor,
                    result.target,
                    result.content,
                    result.sourceRange
                );
            }
            await this.postMessage({
                command: 'generationResult',
                result: {
                    content: result.content,
                    warnings: result.warnings,
                    changed: result.changed,
                    target: result.target
                }
            });
        } catch (error) {
            await this.inlinePreviewService.clear(vscode.window.activeTextEditor, true);
            await this.postMessage({
                command: 'generationError',
                message: formatAIError(error)
            });
        } finally {
            await this.postMessage({
                command: 'setBusy',
                busy: false
            });
        }
    }

    private async applyResult(targetOverride: WritingAssistantTarget | undefined): Promise<void> {
        if (!this.lastResult) {
            vscode.window.showWarningMessage('请先生成内容，再应用到文档。');
            return;
        }

        const editor = vscode.window.activeTextEditor;
        if (!editor || editor.document.languageId !== 'markdown') {
            vscode.window.showWarningMessage('请先切回要写作的 Markdown 文档。');
            return;
        }

        const target = targetOverride || this.lastResult.target;
        if (this.inlinePreviewService.hasActivePreview(editor)) {
            await this.inlinePreviewService.finalize(editor);
        } else {
            await editor.edit((editBuilder) => {
                const content = this.lastResult?.content ?? '';
                switch (target) {
                    case 'insert':
                        editBuilder.insert(editor.selection.active, content);
                        break;
                    case 'replace': {
                        const range = this.lastResult?.sourceUri === editor.document.uri.toString()
                            ? this.lastResult.sourceRange
                            : undefined;
                        const fallbackRange = !editor.selection.isEmpty ? new vscode.Range(editor.selection.start, editor.selection.end) : undefined;
                        editBuilder.replace(range || fallbackRange || new vscode.Range(editor.selection.active, editor.selection.active), content);
                        break;
                    }
                    case 'append': {
                        const document = editor.document;
                        const end = document.positionAt(document.getText().length);
                        const prefix = document.getText().trim().length > 0 ? '\n\n' : '';
                        editBuilder.insert(end, `${prefix}${content}`);
                        break;
                    }
                }
            });
        }

        vscode.window.showInformationMessage('AI 写作辅助结果已应用到当前文档。若需同步人物，请执行“同步本章人物”。');
        await this.pushState();
    }

    private async copyResult(): Promise<void> {
        if (!this.lastResult?.content) {
            vscode.window.showWarningMessage('当前没有可复制的生成结果。');
            return;
        }

        await vscode.env.clipboard.writeText(this.lastResult.content);
        vscode.window.showInformationMessage('已复制生成结果。');
    }

    private async pushState(): Promise<void> {
        const persisted = this.getPersistedState();
        const contextSummary = this.writingAssistantService.getActiveEditorContextSummary();
        await this.postMessage({
            command: 'state',
            state: {
                persisted,
                context: contextSummary,
                hasResult: Boolean(this.lastResult?.content),
                resultTarget: this.lastResult?.target || persisted.target
            }
        });
    }

    private getPersistedState(): PersistedAssistantState {
        return this.context.workspaceState.get<PersistedAssistantState>(AI_ASSISTANT_STATE_KEY, {
            mode: 'continue',
            target: 'insert',
            prompt: ''
        });
    }

    private async postMessage(message: unknown): Promise<void> {
        if (this.view) {
            await this.view.webview.postMessage(message);
        }
    }

    private getHtmlContent(_webview: vscode.Webview): string {
        return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI 写作助手</title>
    <style>
        * { box-sizing: border-box; }
        body {
            margin: 0;
            padding: 12px;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
            background: var(--vscode-sideBar-background);
            color: var(--vscode-foreground);
        }
        .panel {
            display: flex;
            flex-direction: column;
            gap: 12px;
        }
        .card {
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 8px;
            padding: 12px;
        }
        h2, h3 {
            margin: 0 0 8px;
            font-size: 13px;
        }
        .muted {
            color: var(--vscode-descriptionForeground);
            font-size: 12px;
            line-height: 1.5;
        }
        label {
            display: block;
            margin-bottom: 6px;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
        select, textarea, button {
            width: 100%;
            border-radius: 6px;
            border: 1px solid var(--vscode-input-border, transparent);
            font: inherit;
        }
        select, textarea {
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            padding: 8px 10px;
        }
        textarea {
            min-height: 92px;
            resize: vertical;
        }
        .row {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 8px;
        }
        .actions, .result-actions {
            display: flex;
            gap: 8px;
        }
        .actions button, .result-actions button {
            flex: 1;
        }
        button {
            padding: 8px 10px;
            cursor: pointer;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
        }
        button.secondary {
            background: var(--vscode-button-secondaryBackground);
            color: var(--vscode-button-secondaryForeground);
        }
        button:disabled {
            opacity: 0.6;
            cursor: not-allowed;
        }
        #result {
            white-space: pre-wrap;
            line-height: 1.65;
            max-height: 280px;
            overflow: auto;
            font-size: 12px;
            padding: 10px;
            border-radius: 6px;
            background: var(--vscode-textBlockQuote-background, var(--vscode-editor-inactiveSelectionBackground));
        }
        #warnings {
            margin: 0;
            padding-left: 18px;
            color: var(--vscode-editorWarning-foreground, #c58634);
            font-size: 12px;
            line-height: 1.5;
        }
        .empty {
            color: var(--vscode-descriptionForeground);
            font-style: italic;
        }
        .status {
            min-height: 18px;
            font-size: 12px;
            color: var(--vscode-descriptionForeground);
        }
        .shortcut-list {
            margin: 0;
            padding-left: 18px;
            font-size: 12px;
            line-height: 1.6;
            color: var(--vscode-descriptionForeground);
        }
    </style>
</head>
<body>
    <div class="panel">
        <div class="card">
            <h2>AI 写作助手</h2>
            <div class="muted">面向手写创作：当前文档优先、少弹窗、先预览再应用。</div>
            <ol class="shortcut-list" style="margin-top:8px;">
                <li><code>Ctrl/Cmd + Alt + Enter</code>：在编辑器直接生成</li>
                <li><code>Ctrl/Cmd + Alt + I / R / P</code>：插入 / 替换 / 追加</li>
                <li><code>Ctrl/Cmd + Alt + S</code>：用选中文本设置提示</li>
                <li><code>Ctrl/Cmd + Alt + M / T</code>：切换模式 / 应用目标</li>
            </ol>
        </div>

        <div class="card">
            <h3>当前上下文</h3>
            <div id="context" class="muted">请打开一个 Markdown 章节文件。</div>
            <div class="actions" style="margin-top:8px;">
                <button id="refreshBtn" class="secondary">刷新上下文</button>
            </div>
        </div>

        <div class="card">
            <div class="row">
                <div>
                    <label for="mode">辅助模式</label>
                    <select id="mode">
                        <option value="continue">续写当前内容</option>
                        <option value="rewrite">改写选区/段落</option>
                        <option value="expand">扩写选区/段落</option>
                        <option value="polishDialogue">润色对话</option>
                        <option value="summarize">总结当前章节</option>
                    </select>
                </div>
                <div>
                    <label for="target">应用位置</label>
                    <select id="target">
                        <option value="insert">插入光标处</option>
                        <option value="replace">替换选区/段落</option>
                        <option value="append">追加到文末</option>
                    </select>
                </div>
            </div>
            <div style="margin-top:10px;">
                <label for="prompt">补充要求</label>
                <textarea id="prompt" placeholder="例：保持压抑氛围，动作更利落，别写解释性旁白。"></textarea>
            </div>
            <div class="actions" style="margin-top:10px;">
                <button id="generateBtn">生成预览</button>
            </div>
            <div id="status" class="status"></div>
        </div>

        <div class="card">
            <h3>生成预览</h3>
            <ul id="warnings" hidden></ul>
            <div id="result" class="empty">这里会显示可直接应用到当前文档的结果。</div>
            <div class="result-actions" style="margin-top:10px;">
                <button id="insertBtn" class="secondary" disabled>插入</button>
                <button id="replaceBtn" class="secondary" disabled>替换</button>
                <button id="appendBtn" class="secondary" disabled>追加</button>
                <button id="copyBtn" class="secondary" disabled>复制</button>
            </div>
            <div class="result-actions" style="margin-top:8px;">
                <button id="discardBtn" class="secondary">一键丢弃</button>
                <button id="diffBtn" class="secondary">预览 Diff</button>
            </div>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const modeEl = document.getElementById('mode');
        const targetEl = document.getElementById('target');
        const promptEl = document.getElementById('prompt');
        const contextEl = document.getElementById('context');
        const statusEl = document.getElementById('status');
        const resultEl = document.getElementById('result');
        const warningsEl = document.getElementById('warnings');
        const buttons = {
            generate: document.getElementById('generateBtn'),
            refresh: document.getElementById('refreshBtn'),
            insert: document.getElementById('insertBtn'),
            replace: document.getElementById('replaceBtn'),
            append: document.getElementById('appendBtn'),
            copy: document.getElementById('copyBtn'),
            discard: document.getElementById('discardBtn'),
            diff: document.getElementById('diffBtn')
        };

        function setResultAvailable(enabled) {
            buttons.insert.disabled = !enabled;
            buttons.replace.disabled = !enabled;
            buttons.append.disabled = !enabled;
            buttons.copy.disabled = !enabled;
        }

        function renderContext(context) {
            if (!context) {
                contextEl.textContent = '请打开一个 Markdown 章节文件。';
                return;
            }

            const paragraph = context.currentParagraph || '（当前段落为空）';
            contextEl.innerHTML = [
                '<div>文件：' + context.fileName + '</div>',
                '<div>章节：' + context.chapterTitle + '</div>',
                '<div>选区：' + (context.hasSelection ? ('已选中 ' + context.selectionLength + ' 字') : '无选区') + '</div>',
                '<div style="margin-top:6px;">当前段落：' + paragraph.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</div>'
            ].join('');
        }

        function setWarnings(warnings) {
            if (!warnings || warnings.length === 0) {
                warningsEl.hidden = true;
                warningsEl.innerHTML = '';
                return;
            }

            warningsEl.hidden = false;
            warningsEl.innerHTML = warnings
                .map(item => '<li>' + item.replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</li>')
                .join('');
        }

        function applyTarget(target) {
            vscode.postMessage({ command: 'applyResult', target });
        }

        buttons.generate.addEventListener('click', () => {
            vscode.postMessage({
                command: 'generate',
                mode: modeEl.value,
                target: targetEl.value,
                prompt: promptEl.value
            });
        });
        buttons.refresh.addEventListener('click', () => vscode.postMessage({ command: 'refreshContext' }));
        buttons.insert.addEventListener('click', () => applyTarget('insert'));
        buttons.replace.addEventListener('click', () => applyTarget('replace'));
        buttons.append.addEventListener('click', () => applyTarget('append'));
        buttons.copy.addEventListener('click', () => vscode.postMessage({ command: 'copyResult' }));
        buttons.discard.addEventListener('click', () => vscode.postMessage({ command: 'discardPreview' }));
        buttons.diff.addEventListener('click', () => vscode.postMessage({ command: 'showDiff' }));

        promptEl.addEventListener('keydown', (event) => {
            if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
                event.preventDefault();
                buttons.generate.click();
            }
        });

        document.addEventListener('keydown', (event) => {
            if (!(event.ctrlKey || event.metaKey)) {
                return;
            }

            if (event.key === 'Enter') {
                event.preventDefault();
                buttons.generate.click();
                return;
            }

            if (event.altKey && event.key.toLowerCase() === 'i') {
                event.preventDefault();
                applyTarget('insert');
                return;
            }

            if (event.altKey && event.key.toLowerCase() === 'r') {
                event.preventDefault();
                applyTarget('replace');
                return;
            }

            if (event.altKey && event.key.toLowerCase() === 'p') {
                event.preventDefault();
                applyTarget('append');
                return;
            }

            if (event.key.toLowerCase() === 'l') {
                event.preventDefault();
                promptEl.focus();
                promptEl.select();
            }
        });

        window.addEventListener('message', event => {
            const message = event.data;
            switch (message.command) {
                case 'state':
                    modeEl.value = message.state.persisted.mode;
                    targetEl.value = message.state.persisted.target;
                    promptEl.value = message.state.persisted.prompt;
                    renderContext(message.state.context);
                    setResultAvailable(message.state.hasResult);
                    break;
                case 'setBusy':
                    buttons.generate.disabled = message.busy;
                    statusEl.textContent = message.busy ? 'AI 正在生成，请稍候…' : '';
                    break;
                case 'generationResult':
                    resultEl.textContent = message.result.content;
                    resultEl.classList.remove('empty');
                    setWarnings(message.result.warnings);
                    setResultAvailable(true);
                    statusEl.textContent = message.result.changed ? '结果已清洗，可先预览再应用。' : '结果已生成。';
                    break;
                case 'generationError':
                    statusEl.textContent = '生成失败：' + message.message;
                    break;
                case 'streamPreview':
                    resultEl.textContent = message.content;
                    resultEl.classList.remove('empty');
                    statusEl.textContent = 'AI 正在流式生成…';
                    break;
                case 'previewDiscarded':
                    resultEl.textContent = '这里会显示可直接应用到当前文档的结果。';
                    resultEl.classList.add('empty');
                    setWarnings([]);
                    setResultAvailable(false);
                    statusEl.textContent = '已丢弃当前预览。';
                    break;
                case 'focusPrompt':
                    promptEl.focus();
                    break;
            }
        });

        vscode.postMessage({ command: 'ready' });
    </script>
</body>
</html>`;
    }
}
