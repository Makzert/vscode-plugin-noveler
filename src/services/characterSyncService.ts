import * as path from 'path';
import * as vscode from 'vscode';
import { CHAPTERS_FOLDER, CHARACTERS_FOLDER } from '../constants';
import { formatDateTime } from '../utils/dateFormatter';
import { getContentWithoutFrontMatter } from '../utils/frontMatterHelper';
import { parseFrontMatter, stringifyFrontMatter } from '../utils/frontMatterParser';
import { validateCharacterName } from '../utils/inputValidator';
import { LLMClient } from '../ai/LLMClient';
import { ModelRouter } from '../ai/ModelRouter';

const AUTO_GENERATED_TAG = 'auto-generated';
const COMMON_CHINESE_SURNAMES = [
    '赵', '钱', '孙', '李', '周', '吴', '郑', '王', '冯', '陈', '褚', '卫', '蒋', '沈', '韩', '杨', '朱', '秦', '尤', '许',
    '何', '吕', '施', '张', '孔', '曹', '严', '华', '金', '魏', '陶', '姜', '戚', '谢', '邹', '喻', '柏', '水', '窦', '章',
    '云', '苏', '潘', '葛', '奚', '范', '彭', '郎', '鲁', '韦', '昌', '马', '苗', '凤', '花', '方', '俞', '任', '袁', '柳',
    '唐', '罗', '薛', '伍', '余', '米', '姚', '孟', '顾', '尹', '江', '钟', '傅', '邓', '萧', '欧阳', '上官', '司马', '诸葛'
];

export interface CharacterSyncSummary {
    chapterCharactersUpdated: boolean;
    createdCharacters: string[];
    updatedCharacters: string[];
}

export class CharacterSyncService {
    public constructor(
        private readonly llmClient: LLMClient,
        private readonly modelRouter: ModelRouter
    ) {}

    public async syncDocument(document: vscode.TextDocument, preferredNames: string[] = []): Promise<CharacterSyncSummary> {
        if (!this.isChapterDocument(document)) {
            return {
                chapterCharactersUpdated: false,
                createdCharacters: [],
                updatedCharacters: []
            };
        }

        const body = getContentWithoutFrontMatter(document);
        const chapterTitle = this.getChapterTitle(document);
        const existingCharacters = await this.readExistingCharacters();
        const parsed = parseFrontMatter(document.getText());
        const currentCharacters = this.toStringArray((parsed.data as Record<string, unknown>).characters);

        const detectedNames = await this.detectCharacterNames(body, existingCharacters, preferredNames);
        const mergedNames = Array.from(new Set([...currentCharacters, ...preferredNames, ...detectedNames]))
            .map((name) => name.trim())
            .filter((name) => name.length > 0)
            .sort((left, right) => left.localeCompare(right, 'zh-CN'));

        let chapterCharactersUpdated = false;
        if (parsed.isEmpty || !this.arraysEqual(currentCharacters, mergedNames)) {
            const updatedData = {
                ...(parsed.data as Record<string, unknown>),
                characters: mergedNames,
                modified: formatDateTime(new Date())
            };
            const newContent = stringifyFrontMatter(parsed.content, updatedData);
            const edit = new vscode.WorkspaceEdit();
            edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), newContent);
            await vscode.workspace.applyEdit(edit);
            chapterCharactersUpdated = true;
        }

        const createdCharacters: string[] = [];
        const updatedCharacters: string[] = [];
        for (const name of mergedNames) {
            const result = await this.upsertCharacterFile(name, chapterTitle, body);
            if (result === 'created') {
                createdCharacters.push(name);
            } else if (result === 'updated') {
                updatedCharacters.push(name);
            }
        }

        return {
            chapterCharactersUpdated,
            createdCharacters,
            updatedCharacters
        };
    }

    private async upsertCharacterFile(name: string, chapterTitle: string, chapterBody: string): Promise<'created' | 'updated' | 'unchanged'> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return 'unchanged';
        }

        const sanitized = validateCharacterName(name);
        if (!sanitized) {
            return 'unchanged';
        }

        const charactersDir = vscode.Uri.joinPath(workspaceFolder.uri, CHARACTERS_FOLDER);
        await this.ensureDirectory(charactersDir);
        const fileUri = vscode.Uri.joinPath(charactersDir, `${sanitized}.md`);

        try {
            const raw = await vscode.workspace.fs.readFile(fileUri);
            const text = Buffer.from(raw).toString('utf8');
            const parsed = parseFrontMatter<Record<string, unknown>>(text);
            if (parsed.isEmpty) {
                return 'unchanged';
            }

            const tags = this.toStringArray(parsed.data.tags);
            const profile = await this.summarizeCharacterProfile(name, chapterTitle, chapterBody);
            const updatedData = {
                ...parsed.data,
                name: String(parsed.data.name || sanitized),
                appearance: parsed.data.appearance || profile.appearance,
                personality: parsed.data.personality || profile.personality,
                background: parsed.data.background || profile.background,
                firstAppearance: parsed.data.firstAppearance || chapterTitle,
                tags: Array.from(new Set([...tags, AUTO_GENERATED_TAG])),
                modified: formatDateTime(new Date())
            };

            const updatedContent = stringifyFrontMatter(parsed.content, updatedData);
            if (updatedContent !== text) {
                await vscode.workspace.fs.writeFile(fileUri, Buffer.from(updatedContent, 'utf8'));
                return 'updated';
            }

            return 'unchanged';
        } catch {
            const now = formatDateTime(new Date());
            const profile = await this.summarizeCharacterProfile(sanitized, chapterTitle, chapterBody);
            const content = `---
name: ${sanitized}
gender: ""
age: ""
appearance: ${JSON.stringify(profile.appearance || '')}
personality: ${JSON.stringify(profile.personality || '')}
background: ${JSON.stringify(profile.background || '')}
relationships: []
abilities: []
importance: 次要配角
firstAppearance: ${chapterTitle}
tags: ["${AUTO_GENERATED_TAG}"]
created: '${now}'
modified: '${now}'
---
# ${sanitized}

## 基本信息

- 由章节内容自动同步创建，请后续补充。
`;
            await vscode.workspace.fs.writeFile(fileUri, Buffer.from(content, 'utf8'));
            return 'created';
        }
    }

    private async summarizeCharacterProfile(
        name: string,
        chapterTitle: string,
        chapterBody: string
    ): Promise<{ appearance: string; personality: string; background: string }> {
        const config = this.llmClient.getConfigSnapshot();
        if (!config?.apiKey || !config.baseUrl) {
            return { appearance: '', personality: '', background: '' };
        }

        const excerpt = this.buildCharacterExcerpt(chapterBody, name);
        if (!excerpt) {
            return { appearance: '', personality: '', background: '' };
        }

        try {
            const raw = await this.llmClient.generateMessages([
                {
                    role: 'system',
                    content: '你是一个人物信息整理器。只返回 JSON 对象，不要解释，不要 Markdown。'
                },
                {
                    role: 'user',
                    content: [
                        `请根据小说片段，为人物“${name}”提取档案补全信息。`,
                        '返回格式必须是 JSON 对象：{"appearance":"","personality":"","background":""}',
                        '要求：',
                        '1. 只根据已有片段归纳，不要编造重大设定。',
                        '2. 不确定就返回空字符串。',
                        `3. 当前章节：${chapterTitle}`,
                        '',
                        '片段：',
                        excerpt
                    ].join('\n')
                }
            ], {
                model: this.modelRouter.resolveModel(config, 'medium'),
                temperature: 0.2,
                maxTokens: 400
            });

            const parsed = JSON.parse(raw) as Record<string, unknown>;
            return {
                appearance: this.toOptionalString(parsed.appearance) || '',
                personality: this.toOptionalString(parsed.personality) || '',
                background: this.toOptionalString(parsed.background) || ''
            };
        } catch {
            return { appearance: '', personality: '', background: '' };
        }
    }

    private buildCharacterExcerpt(body: string, name: string): string {
        const lines = body.split(/\r?\n/);
        const related: string[] = [];

        for (let index = 0; index < lines.length; index++) {
            if (!lines[index].includes(name)) {
                continue;
            }

            const start = Math.max(0, index - 1);
            const end = Math.min(lines.length - 1, index + 1);
            related.push(lines.slice(start, end + 1).join('\n').trim());
            if (related.join('\n').length > 1200) {
                break;
            }
        }

        return related.join('\n\n').slice(0, 1500);
    }

    private async detectCharacterNames(body: string, existingNames: string[], preferredNames: string[]): Promise<string[]> {
        const names = new Set<string>();

        for (const name of existingNames) {
            if (name && body.includes(name)) {
                names.add(name);
            }
        }

        for (const name of preferredNames) {
            if (name) {
                names.add(name);
            }
        }

        for (const name of await this.extractNamesWithLLM(body, existingNames)) {
            names.add(name);
        }

        const candidateCounts = new Map<string, number>();
        const chineseNamePattern = new RegExp(`(?:${COMMON_CHINESE_SURNAMES.sort((a, b) => b.length - a.length).join('|')})[\\u4e00-\\u9fa5]{1,2}`, 'g');
        for (const match of body.match(chineseNamePattern) || []) {
            const count = candidateCounts.get(match) || 0;
            candidateCounts.set(match, count + 1);
        }

        for (const [name, count] of candidateCounts.entries()) {
            if (count >= 2 && !this.isLikelyNarrativePhrase(name)) {
                names.add(name);
            }
        }

        return Array.from(names);
    }

    private async extractNamesWithLLM(body: string, existingNames: string[]): Promise<string[]> {
        const config = this.llmClient.getConfigSnapshot();
        if (!config?.apiKey || !config.baseUrl) {
            return [];
        }

        const excerpt = body.length > 3600
            ? `${body.slice(0, 1600)}\n...\n${body.slice(-1800)}`
            : body;
        if (!excerpt.trim()) {
            return [];
        }

        try {
            const raw = await this.llmClient.generateMessages([
                {
                    role: 'system',
                    content: '你是一个人物名抽取器。只返回 JSON 数组，不要解释，不要 Markdown，不要额外文字。'
                },
                {
                    role: 'user',
                    content: [
                        '请从下面的中文小说片段中抽取明确出现的人物姓名。',
                        '要求：',
                        '1. 只保留人物姓名，不保留称谓、代词、普通名词。',
                        '2. 优先识别已有名单中的人物，也可识别新人物。',
                        '3. 返回格式必须是 JSON 字符串数组，例如 ["林霄","苏晚"]。',
                        `已有角色名单：${existingNames.join('、') || '无'}`,
                        '',
                        '小说片段：',
                        excerpt
                    ].join('\n')
                }
            ], {
                model: this.modelRouter.resolveModel(config, 'low'),
                temperature: 0.1,
                maxTokens: 300
            });

            const parsed = JSON.parse(raw) as unknown;
            if (!Array.isArray(parsed)) {
                return [];
            }

            return parsed
                .filter((item): item is string => typeof item === 'string')
                .map((item) => item.trim())
                .filter((item) => item.length >= 2 && item.length <= 6);
        } catch {
            return [];
        }
    }

    private isLikelyNarrativePhrase(value: string): boolean {
        const blocked = ['一声', '一个', '一种', '一天', '一阵', '一名', '一位', '这时', '那人', '自己'];
        return blocked.includes(value);
    }

    private async readExistingCharacters(): Promise<string[]> {
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            return [];
        }

        try {
            const dir = vscode.Uri.joinPath(workspaceFolder.uri, CHARACTERS_FOLDER);
            const entries = await vscode.workspace.fs.readDirectory(dir);
            return entries
                .filter(([name, type]) => type === vscode.FileType.File && name.endsWith('.md'))
                .map(([name]) => path.basename(name, '.md'));
        } catch {
            return [];
        }
    }

    private async ensureDirectory(uri: vscode.Uri): Promise<void> {
        try {
            await vscode.workspace.fs.stat(uri);
        } catch {
            await vscode.workspace.fs.createDirectory(uri);
        }
    }

    private getChapterTitle(document: vscode.TextDocument): string {
        const parsed = parseFrontMatter<Record<string, unknown>>(document.getText());
        const title = typeof parsed.data.title === 'string' ? parsed.data.title.trim() : '';
        if (title) {
            return title;
        }

        return path.basename(document.fileName, path.extname(document.fileName));
    }

    private isChapterDocument(document: vscode.TextDocument): boolean {
        return document.languageId === 'markdown' && document.uri.fsPath.includes(`/${CHAPTERS_FOLDER}/`);
    }

    private toStringArray(value: unknown): string[] {
        if (!Array.isArray(value)) {
            return [];
        }

        return value
            .filter((item): item is string => typeof item === 'string')
            .map((item) => item.trim())
            .filter((item) => item.length > 0);
    }

    private toOptionalString(value: unknown): string | undefined {
        return typeof value === 'string' && value.trim().length > 0 ? value.trim() : undefined;
    }

    private arraysEqual(left: string[], right: string[]): boolean {
        if (left.length !== right.length) {
            return false;
        }

        return left.every((item, index) => item === right[index]);
    }
}
