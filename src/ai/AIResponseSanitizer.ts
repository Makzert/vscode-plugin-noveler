export interface SanitizedAIResponse {
    content: string;
    warnings: string[];
    changed: boolean;
}

export interface SanitizeAIResponseOptions {
    chapterTitle?: string;
    mode: 'prose' | 'summary';
}

const META_LINE_PATTERNS = [
    /^(?:当然|好的|可以|没问题)[，。:]?/,
    /^以下(?:是|为)/,
    /^我(?:来|将|会|先)/,
    /^这是/,
    /^(?:续写|润色|改写|重写|扩写|总结|摘要)(?:如下|结果|内容)?[：:]?$/,
    /^(?:说明|注|备注)[：:]/
];

const TRAILING_META_LINE_PATTERNS = [
    /^如果你还需要/,
    /^需要的话我可以/,
    /^如需/,
    /^你可以继续/
];

export class AIResponseSanitizer {
    public sanitize(raw: string, options: SanitizeAIResponseOptions): SanitizedAIResponse {
        const warnings: string[] = [];
        let content = raw.trim();
        const original = content;

        content = this.stripThinking(content, warnings);
        content = this.stripWrappedCodeFence(content);
        content = this.stripFrontMatter(content, warnings);
        content = this.stripLeadingMeta(content, warnings);
        content = this.stripTrailingMeta(content, warnings);
        content = this.stripTitleDuplication(content, options.chapterTitle, warnings);
        content = this.normalizeSpacing(content, options.mode);

        if (options.mode === 'prose') {
            content = this.stripLeadingHeading(content, warnings);
        }

        if (/(?:<think|思考过程|推理过程|提示词|System Prompt)/i.test(content)) {
            warnings.push('结果中仍可能残留推理或提示词痕迹，请先预览再应用。');
        }

        if (options.mode === 'prose' && /^#{1,6}\s+/m.test(content)) {
            warnings.push('结果中包含标题标记，已尽量清理；应用前建议检查。');
        }

        return {
            content: content.trim(),
            warnings,
            changed: original !== content.trim()
        };
    }

    public sanitizePreview(raw: string, options: SanitizeAIResponseOptions): string {
        let content = raw;
        content = content.replace(/<(think|thinking)[^>]*>[\s\S]*?<\/\1>/gi, '');
        content = content.replace(/<(think|thinking)[^>]*>[\s\S]*$/gi, '');
        content = content.replace(/```(?:thinking|analysis)[\s\S]*?```/gi, '');
        content = content.replace(/```(?:thinking|analysis)[\s\S]*$/gi, '');
        content = this.stripWrappedCodeFence(content);
        content = this.stripFrontMatter(content, []);
        content = this.stripLeadingMeta(content, []);
        content = this.stripTrailingMeta(content, []);
        content = this.stripTitleDuplication(content, options.chapterTitle, []);
        if (options.mode === 'prose') {
            content = this.stripLeadingHeading(content, []);
        }
        return this.normalizeSpacing(content, options.mode);
    }

    private stripThinking(content: string, warnings: string[]): string {
        let result = content;
        const before = result;
        result = result.replace(/<(think|thinking)[^>]*>[\s\S]*?<\/\1>/gi, '').trim();
        result = result.replace(/```(?:thinking|analysis)[\s\S]*?```/gi, '').trim();
        if (result !== before) {
            warnings.push('已移除模型返回中的思考/分析片段。');
        }
        return result;
    }

    private stripWrappedCodeFence(content: string): string {
        let result = content.trim();
        const wrappedFence = /^```(?:markdown|md|text)?\s*([\s\S]*?)\s*```$/i;
        while (wrappedFence.test(result)) {
            result = result.replace(wrappedFence, '$1').trim();
        }
        return result;
    }

    private stripFrontMatter(content: string, warnings: string[]): string {
        if (!content.startsWith('---\n')) {
            return content;
        }

        const endIndex = content.indexOf('\n---', 4);
        if (endIndex === -1) {
            return content;
        }

        warnings.push('已移除返回结果中的 Front Matter。');
        return content.slice(endIndex + 4).trim();
    }

    private stripLeadingMeta(content: string, warnings: string[]): string {
        const lines = content.split('\n');
        let removed = false;

        while (lines.length > 0) {
            const current = lines[0].trim();
            if (!current) {
                lines.shift();
                removed = true;
                continue;
            }

            if (META_LINE_PATTERNS.some((pattern) => pattern.test(current)) && current.length <= 40) {
                lines.shift();
                removed = true;
                continue;
            }

            break;
        }

        if (removed) {
            warnings.push('已清理结果开头的说明性话术。');
        }

        return lines.join('\n').trim();
    }

    private stripTrailingMeta(content: string, warnings: string[]): string {
        const lines = content.split('\n');
        let removed = false;

        while (lines.length > 0) {
            const current = lines[lines.length - 1].trim();
            if (!current) {
                lines.pop();
                removed = true;
                continue;
            }

            if (TRAILING_META_LINE_PATTERNS.some((pattern) => pattern.test(current))) {
                lines.pop();
                removed = true;
                continue;
            }

            break;
        }

        if (removed) {
            warnings.push('已清理结果末尾的附加说明。');
        }

        return lines.join('\n').trim();
    }

    private stripTitleDuplication(content: string, chapterTitle: string | undefined, warnings: string[]): string {
        const lines = content.split('\n');
        if (lines.length === 0) {
            return content;
        }

        const firstLine = lines[0].trim();
        const normalizedTitle = chapterTitle?.trim();
        const genericTitles = new Set(['章节正文', '正文', '续写内容', '润色结果', '改写结果']);

        if (
            /^#{1,6}\s+/.test(firstLine) ||
            (normalizedTitle && firstLine === normalizedTitle) ||
            (normalizedTitle && firstLine === `# ${normalizedTitle}`) ||
            genericTitles.has(firstLine)
        ) {
            warnings.push('已移除重复标题或通用标题。');
            lines.shift();
        }

        return lines.join('\n').trim();
    }

    private stripLeadingHeading(content: string, warnings: string[]): string {
        const lines = content.split('\n');
        if (lines.length === 0) {
            return content;
        }

        if (/^#{1,6}\s+/.test(lines[0].trim())) {
            warnings.push('已移除结果中的 Markdown 标题。');
            lines.shift();
        }

        return lines.join('\n').trim();
    }

    private normalizeSpacing(content: string, mode: 'prose' | 'summary'): string {
        const normalized = content
            .replace(/\r\n/g, '\n')
            .replace(/\n{3,}/g, '\n\n')
            .trim();

        if (mode === 'summary') {
            return normalized;
        }

        return normalized.replace(/[ \t]+\n/g, '\n');
    }
}
