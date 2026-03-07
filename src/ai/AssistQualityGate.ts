export type AssistMode = 'continue' | 'rewrite' | 'expand' | 'polishDialogue' | 'summarize';

export interface AssistQualityContext {
    chapterTitle: string;
    selectionText: string;
    currentParagraph: string;
    beforeCursor: string;
    afterCursor: string;
}

export interface AssistQualityGateResult {
    accepted: boolean;
    warnings: string[];
    reason?: string;
}

const EXPLANATORY_FLUFF_PATTERNS: RegExp[] = [
    /^(?:当然|好的|可以|没问题)[，。:：]?/,
    /^以下(?:是|为)/,
    /^我(?:将|会|来|先)/,
    /^这是(?:你|本次|根据)/,
    /^(?:说明|注|备注)[:：]/
];

export function evaluateAssistQuality(
    mode: AssistMode,
    context: AssistQualityContext,
    content: string
): AssistQualityGateResult {
    const warnings: string[] = [];
    const trimmed = content.trim();
    const lines = trimmed.split('\n').map((line) => line.trim()).filter(Boolean);
    const firstLine = lines[0] ?? '';

    if (mode !== 'summarize') {
        const isDuplicateTitle = firstLine === context.chapterTitle || firstLine === `# ${context.chapterTitle}` || /^#{1,6}\s+/.test(firstLine);
        if (isDuplicateTitle) {
            return {
                accepted: false,
                warnings,
                reason: 'AI 输出包含重复标题，已拦截。请重试。'
            };
        }
    }

    if (lines.slice(0, 2).some((line) => EXPLANATORY_FLUFF_PATTERNS.some((pattern) => pattern.test(line)))) {
        return {
            accepted: false,
            warnings,
            reason: 'AI 输出包含解释性废话，已拦截。请重试。'
        };
    }

    if (mode !== 'summarize' && isObviouslyOffTopic(context, trimmed)) {
        return {
            accepted: false,
            warnings,
            reason: 'AI 输出与当前章节上下文明显跑题，已拦截。请调整提示词后重试。'
        };
    }

    if (mode !== 'summarize' && hasNarrativeVoiceShift(context, trimmed)) {
        warnings.push('检测到人称/叙事语气可能漂移，应用前建议先预览检查。');
    }

    return {
        accepted: true,
        warnings
    };
}

function isObviouslyOffTopic(context: AssistQualityContext, output: string): boolean {
    const source = [
        context.selectionText,
        context.currentParagraph,
        context.beforeCursor.slice(Math.max(0, context.beforeCursor.length - 300)),
        context.afterCursor.slice(0, 300)
    ].filter(Boolean).join('\n');

    if (!source.trim() || output.length < 180) {
        return false;
    }

    const sourceKeywords = extractKeywords(source);
    const outputKeywords = extractKeywords(output);
    if (sourceKeywords.size < 4 || outputKeywords.size < 6) {
        return false;
    }

    let overlap = 0;
    for (const keyword of outputKeywords) {
        if (sourceKeywords.has(keyword)) {
            overlap++;
        }
    }

    const overlapRate = overlap / outputKeywords.size;
    return overlapRate < 0.08;
}

function hasNarrativeVoiceShift(context: AssistQualityContext, output: string): boolean {
    const source = `${context.currentParagraph}\n${context.beforeCursor}`;
    const sourceFirst = (source.match(/(?:^|[，。！？\s])我(?:们)?(?:[，。！？\s]|$)/g) || []).length;
    const sourceThird = (source.match(/(?:^|[，。！？\s])(?:他|她|他们|她们)(?:[，。！？\s]|$)/g) || []).length;
    const outputFirst = (output.match(/(?:^|[，。！？\s])我(?:们)?(?:[，。！？\s]|$)/g) || []).length;
    const outputThird = (output.match(/(?:^|[，。！？\s])(?:他|她|他们|她们)(?:[，。！？\s]|$)/g) || []).length;

    return sourceFirst >= 2 && outputFirst === 0 && outputThird > sourceThird;
}

function extractKeywords(text: string): Set<string> {
    const keywords = new Set<string>();
    const chineseWords = text.match(/[\u4e00-\u9fa5]{2,6}/g) || [];
    for (const word of chineseWords) {
        if (!isStopWord(word)) {
            keywords.add(word);
        }
    }

    const englishWords = text.toLowerCase().match(/[a-z]{4,}/g) || [];
    for (const word of englishWords) {
        keywords.add(word);
    }

    return keywords;
}

function isStopWord(word: string): boolean {
    return ['我们', '你们', '他们', '她们', '自己', '然后', '但是', '因为', '所以', '这个', '那个', '开始', '时候', '已经', '没有'].includes(word);
}
