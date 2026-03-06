import * as vscode from 'vscode';
import { CHAPTERS_FOLDER, CHARACTERS_FOLDER, DRAFTS_FOLDER, REFERENCES_FOLDER } from '../constants';
import { extractFrontMatter, getContentWithoutFrontMatter } from '../utils/frontMatterHelper';

export interface ProjectCharacterContext {
    name: string;
    importance?: string;
    firstAppearance?: string;
    appearance?: string;
    personality?: string;
    background?: string;
    relationships?: string[];
    abilities?: string[];
    notes?: string;
    path: string;
}

export interface ProjectReferenceContext {
    title: string;
    content: string;
    path: string;
}

export interface ProjectOutlineContext {
    title: string;
    content: string;
    path: string;
}

export interface ProjectRecentChapterContext {
    title: string;
    chapter?: number;
    summary: string;
    characters?: string[];
    locations?: string[];
    tags?: string[];
    status?: string;
    path: string;
}

export interface ProjectContext {
    outline?: ProjectOutlineContext;
    characters: ProjectCharacterContext[];
    references: ProjectReferenceContext[];
    recentChapters: ProjectRecentChapterContext[];
}

export class ProjectContextService {
    public async getProjectContext(): Promise<ProjectContext> {
        const [outline, characters, references] = await Promise.all([
            this.readOutline(),
            this.readCharacters(),
            this.readReferences()
        ]);

        return {
            outline,
            characters,
            references,
            recentChapters: await this.readRecentChapters()
        };
    }

    private async readOutline(): Promise<ProjectOutlineContext | undefined> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return undefined;
        }

        try {
            const draftsUri = vscode.Uri.joinPath(workspaceFolder.uri, DRAFTS_FOLDER);
            const entries = await vscode.workspace.fs.readDirectory(draftsUri);
            const outlineCandidates = entries
                .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.md'))
                .map(([name]) => name)
                .sort((left, right) => {
                    if (left === '大纲.md') {
                        return -1;
                    }
                    if (right === '大纲.md') {
                        return 1;
                    }
                    return left.localeCompare(right, 'zh-CN');
                });

            if (outlineCandidates.length === 0) {
                return undefined;
            }

            const outlineFileName = outlineCandidates[0];
            const outlineUri = vscode.Uri.joinPath(workspaceFolder.uri, DRAFTS_FOLDER, outlineFileName);
            const content = await vscode.workspace.fs.readFile(outlineUri);
            return {
                title: outlineFileName.replace(/\.md$/, ''),
                content: Buffer.from(content).toString('utf8').trim(),
                path: outlineUri.fsPath
            };
        } catch {
            return undefined;
        }
    }

    private async readCharacters(): Promise<ProjectCharacterContext[]> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return [];
        }

        const charactersUri = vscode.Uri.joinPath(workspaceFolder.uri, CHARACTERS_FOLDER);
        try {
            const entries = await vscode.workspace.fs.readDirectory(charactersUri);
            const files = entries.filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.md'));
            const characters = await Promise.all(files.map(async ([name]) => {
                const fileUri = vscode.Uri.joinPath(charactersUri, name);
                const document = await vscode.workspace.openTextDocument(fileUri);
                const frontMatter = extractFrontMatter(document);
                const notes = getContentWithoutFrontMatter(document).split('\n').slice(0, 12).join('\n').trim();

                return {
                    name: String(frontMatter.name || frontMatter.title || name.replace(/\.md$/, '')).trim(),
                    importance: this.toOptionalString(frontMatter.importance),
                    firstAppearance: this.toOptionalString(frontMatter.firstAppearance),
                    appearance: this.toOptionalString(frontMatter.appearance),
                    personality: this.toOptionalString(frontMatter.personality),
                    background: this.toOptionalString(frontMatter.background),
                    relationships: this.toOptionalStringArray(frontMatter.relationships),
                    abilities: this.toOptionalStringArray(frontMatter.abilities),
                    notes,
                    path: fileUri.fsPath
                };
            }));

            return characters;
        } catch {
            return [];
        }
    }

    private async readReferences(): Promise<ProjectReferenceContext[]> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return [];
        }

        const referencesUri = vscode.Uri.joinPath(workspaceFolder.uri, REFERENCES_FOLDER);
        try {
            const entries = await vscode.workspace.fs.readDirectory(referencesUri);
            const files = entries.filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.md'));
            const references = await Promise.all(files.map(async ([name]) => {
                const fileUri = vscode.Uri.joinPath(referencesUri, name);
                const content = await vscode.workspace.fs.readFile(fileUri);
                const text = Buffer.from(content).toString('utf8').trim();

                return {
                    title: name.replace(/\.md$/, ''),
                    content: text.split('\n').slice(0, 20).join('\n').trim(),
                    path: fileUri.fsPath
                };
            }));

            return references;
        } catch {
            return [];
        }
    }

    private async readRecentChapters(): Promise<ProjectRecentChapterContext[]> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return [];
        }

        const chaptersUri = vscode.Uri.joinPath(workspaceFolder.uri, CHAPTERS_FOLDER);
        try {
            const chapterFiles = await this.collectMarkdownFiles(chaptersUri);
            const filtered = chapterFiles
                .filter((uri) => !uri.path.endsWith('/outline.md'))
                .sort((left, right) => right.path.localeCompare(left.path, 'zh-CN'))
                .slice(0, 3);

            return Promise.all(filtered.map(async (fileUri) => {
                const document = await vscode.workspace.openTextDocument(fileUri);
                const frontMatter = extractFrontMatter(document);
                const summary = getContentWithoutFrontMatter(document)
                    .split('\n')
                    .filter((line) => line.trim().length > 0)
                    .slice(0, 10)
                    .join('\n')
                    .trim();

                return {
                    title: this.toOptionalString(frontMatter.title) || fileUri.path.split('/').pop()?.replace(/\.md$/, '') || '未命名章节',
                    chapter: this.toOptionalNumber(frontMatter.chapter),
                    summary,
                    characters: this.toOptionalStringArray(frontMatter.characters),
                    locations: this.toOptionalStringArray(frontMatter.locations),
                    tags: this.toOptionalStringArray(frontMatter.tags),
                    status: this.toOptionalString(frontMatter.status),
                    path: fileUri.fsPath
                };
            }));
        } catch {
            return [];
        }
    }

    private async collectMarkdownFiles(folderUri: vscode.Uri): Promise<vscode.Uri[]> {
        const entries = await vscode.workspace.fs.readDirectory(folderUri);
        const files: vscode.Uri[] = [];

        for (const [name, type] of entries) {
            const entryUri = vscode.Uri.joinPath(folderUri, name);
            if (type === vscode.FileType.File && name.endsWith('.md')) {
                files.push(entryUri);
            } else if (type === vscode.FileType.Directory) {
                files.push(...await this.collectMarkdownFiles(entryUri));
            }
        }

        return files;
    }

    private toOptionalString(value: unknown): string | undefined {
        return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
    }

    private toOptionalStringArray(value: unknown): string[] | undefined {
        if (!Array.isArray(value)) {
            return undefined;
        }

        const result = value
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim())
            .filter((item) => item.length > 0);

        return result.length > 0 ? result : undefined;
    }

    private toOptionalNumber(value: unknown): number | undefined {
        return typeof value === 'number' ? value : undefined;
    }
}
