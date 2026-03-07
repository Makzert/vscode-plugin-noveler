export const AI_PREVIEW_MAX_CHARS = 1200;

export function truncatePreviewContent(content: string, maxChars = AI_PREVIEW_MAX_CHARS): string {
    if (content.length <= maxChars) {
        return content;
    }

    return `${content.slice(0, maxChars)}\n\n……（预览已截断，应用时将使用完整内容）`;
}
