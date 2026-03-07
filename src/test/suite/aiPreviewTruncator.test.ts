import * as assert from 'assert';
import { AI_PREVIEW_MAX_CHARS, truncatePreviewContent } from '../../services/AIPreviewTruncator';

suite('AIPreviewTruncator Test Suite', () => {
    test('should keep short preview unchanged', () => {
        const text = '短文本预览';
        assert.strictEqual(truncatePreviewContent(text), text);
    });

    test('should truncate long preview and append hint', () => {
        const long = '甲'.repeat(AI_PREVIEW_MAX_CHARS + 200);
        const truncated = truncatePreviewContent(long);

        assert.ok(truncated.length < long.length);
        assert.ok(truncated.includes('预览已截断'));
        assert.strictEqual(truncated.startsWith('甲'.repeat(20)), true);
    });
});
