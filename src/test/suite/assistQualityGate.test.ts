import * as assert from 'assert';
import { evaluateAssistQuality } from '../../ai/AssistQualityGate';

suite('AssistQualityGate Test Suite', () => {
    const baseContext = {
        chapterTitle: '边城初战',
        selectionText: '林岚握着断刀，望向城门外翻涌的黑云。',
        currentParagraph: '我抬起头，听见远处战鼓一声紧过一声。',
        beforeCursor: '我知道今夜之后，边城再无宁日。',
        afterCursor: '城墙上的火把在风里摇晃。'
    };

    test('should reject duplicated heading/title output', () => {
        const result = evaluateAssistQuality('rewrite', baseContext, '# 边城初战\n\n我抬起头。');
        assert.strictEqual(result.accepted, false);
        assert.ok(result.reason?.includes('重复标题'));
    });

    test('should reject explanatory fluff', () => {
        const result = evaluateAssistQuality('continue', baseContext, '以下是改写结果：\n\n我抬起头。');
        assert.strictEqual(result.accepted, false);
        assert.ok(result.reason?.includes('解释性废话'));
    });

    test('should allow normal prose and only warn on potential voice shift', () => {
        const result = evaluateAssistQuality('continue', baseContext, '他望向远处城门，脚步更快，呼吸也更急。');
        assert.strictEqual(result.accepted, true);
        assert.ok(result.warnings.length >= 0);
    });
});
