import * as vscode from 'vscode';
import { WritingAssistantTarget } from '../ai/WritingAssistantService';

interface PreviewSession {
    uri: string;
    target: WritingAssistantTarget;
    startOffset: number;
    previewLength: number;
    originalText: string;
    prefix: string;
}

export interface InlinePreviewSnapshot {
    originalText: string;
    previewText: string;
    target: WritingAssistantTarget;
}

export class AIInlinePreviewService implements vscode.Disposable {
    private readonly previewDecoration = vscode.window.createTextEditorDecorationType({
        backgroundColor: new vscode.ThemeColor('editor.findMatchHighlightBackground'),
        border: '1px dashed',
        borderColor: new vscode.ThemeColor('editorWidget.border'),
        fontStyle: 'italic',
        overviewRulerColor: new vscode.ThemeColor('editorWarning.foreground'),
        overviewRulerLane: vscode.OverviewRulerLane.Right,
        after: {
            margin: '0 0 0 1em',
            color: new vscode.ThemeColor('editorCodeLens.foreground'),
            contentText: '← AI 预览（未应用）'
        }
    });

    private session?: PreviewSession;

    public async showStreaming(
        editor: vscode.TextEditor,
        target: WritingAssistantTarget,
        content: string,
        sourceRange?: vscode.Range
    ): Promise<void> {
        if (this.session && this.session.uri !== editor.document.uri.toString()) {
            await this.clear(undefined, true);
        }

        if (!this.session) {
            await this.startSession(editor, target, sourceRange);
        }

        if (!this.session || this.session.uri !== editor.document.uri.toString()) {
            return;
        }

        const document = editor.document;
        const start = document.positionAt(this.session.startOffset);
        const end = document.positionAt(this.session.startOffset + this.session.previewLength);
        const replacement = `${this.session.prefix}${content}`;

        await editor.edit((editBuilder) => {
            editBuilder.replace(new vscode.Range(start, end), replacement);
        }, { undoStopAfter: false, undoStopBefore: false });

        this.session.previewLength = replacement.length;
        this.applyDecoration(editor);
    }

    public async finalize(editor?: vscode.TextEditor): Promise<boolean> {
        const activeEditor = editor || vscode.window.activeTextEditor;
        if (!activeEditor || !this.session || this.session.uri !== activeEditor.document.uri.toString()) {
            return false;
        }

        const document = activeEditor.document;
        const start = document.positionAt(this.session.startOffset);
        const end = document.positionAt(this.session.startOffset + this.session.previewLength);
        const finalContent = document.getText(new vscode.Range(start, end)).replace(this.session.prefix, '');

        await activeEditor.edit((editBuilder) => {
            editBuilder.replace(new vscode.Range(start, end), finalContent);
        });

        this.clearDecoration(activeEditor);
        this.session = undefined;
        return true;
    }

    public async clear(editor?: vscode.TextEditor, restoreOriginal = true): Promise<void> {
        const activeEditor = editor || vscode.window.activeTextEditor;
        if (!activeEditor || !this.session || this.session.uri !== activeEditor.document.uri.toString()) {
            this.clearDecoration(activeEditor);
            return;
        }

        if (restoreOriginal) {
            const document = activeEditor.document;
            const start = document.positionAt(this.session.startOffset);
            const end = document.positionAt(this.session.startOffset + this.session.previewLength);
            await activeEditor.edit((editBuilder) => {
                editBuilder.replace(new vscode.Range(start, end), this.session?.originalText ?? '');
            }, { undoStopAfter: false, undoStopBefore: false });
        }

        this.clearDecoration(activeEditor);
        this.session = undefined;
    }

    public hasActivePreview(editor?: vscode.TextEditor): boolean {
        const activeEditor = editor || vscode.window.activeTextEditor;
        return Boolean(activeEditor && this.session && this.session.uri === activeEditor.document.uri.toString());
    }

    public getSnapshot(editor?: vscode.TextEditor): InlinePreviewSnapshot | undefined {
        const activeEditor = editor || vscode.window.activeTextEditor;
        if (!activeEditor || !this.session || this.session.uri !== activeEditor.document.uri.toString()) {
            return undefined;
        }

        const document = activeEditor.document;
        const start = document.positionAt(this.session.startOffset);
        const end = document.positionAt(this.session.startOffset + this.session.previewLength);
        const current = document.getText(new vscode.Range(start, end)).replace(this.session.prefix, '');

        return {
            originalText: this.session.originalText,
            previewText: current,
            target: this.session.target
        };
    }

    public dispose(): void {
        this.clearDecoration(vscode.window.activeTextEditor);
        this.previewDecoration.dispose();
    }

    private async startSession(editor: vscode.TextEditor, target: WritingAssistantTarget, sourceRange?: vscode.Range): Promise<void> {
        const document = editor.document;
        let targetRange: vscode.Range;
        let prefix = '';

        switch (target) {
            case 'replace':
                targetRange = sourceRange || (!editor.selection.isEmpty
                    ? new vscode.Range(editor.selection.start, editor.selection.end)
                    : new vscode.Range(editor.selection.active, editor.selection.active));
                prefix = '⟪AI 预览⟫\n';
                break;
            case 'append': {
                const end = document.positionAt(document.getText().length);
                const prefixText = document.getText().trim().length > 0 ? '\n\n⟪AI 预览⟫\n' : '⟪AI 预览⟫\n';
                targetRange = new vscode.Range(end, end);
                prefix = prefixText;
                break;
            }
            case 'insert':
            default:
                targetRange = new vscode.Range(editor.selection.active, editor.selection.active);
                prefix = '⟪AI 预览⟫';
                break;
        }

        const originalText = document.getText(targetRange);
        const startOffset = document.offsetAt(targetRange.start);
        await editor.edit((editBuilder) => {
            editBuilder.replace(targetRange, prefix);
        }, { undoStopAfter: false, undoStopBefore: false });

        this.session = {
            uri: document.uri.toString(),
            target,
            startOffset,
            previewLength: prefix.length,
            originalText,
            prefix
        };
        this.applyDecoration(editor);
    }

    private applyDecoration(editor: vscode.TextEditor): void {
        if (!this.session || this.session.uri !== editor.document.uri.toString()) {
            return;
        }

        const start = editor.document.positionAt(this.session.startOffset);
        const end = editor.document.positionAt(this.session.startOffset + this.session.previewLength);
        editor.setDecorations(this.previewDecoration, [new vscode.Range(start, end)]);
    }

    private clearDecoration(editor?: vscode.TextEditor): void {
        editor?.setDecorations(this.previewDecoration, []);
    }
}
