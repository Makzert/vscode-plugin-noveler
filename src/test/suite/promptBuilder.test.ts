import * as assert from 'assert';
import { PromptBuilder } from '../../ai/PromptBuilder';

suite('PromptBuilder Test Suite', () => {
    test('should render variables in system and user prompts', () => {
        const builder = new PromptBuilder();
        const prompt = builder.build({
            system: '系统：{role}',
            user: '主题：{topic}',
            variables: {
                role: '策划编辑',
                topic: '边城复仇'
            }
        });

        assert.strictEqual(prompt.systemPrompt, '系统：策划编辑');
        assert.strictEqual(prompt.userPrompt, '主题：边城复仇');
        assert.strictEqual(prompt.combinedPrompt, '系统：策划编辑\n\n主题：边城复仇');
    });

    test('should replace missing variables with empty strings', () => {
        const builder = new PromptBuilder();
        const rendered = builder.renderTemplate('角色：{name}，目标：{goal}', {
            name: '林岚'
        });

        assert.strictEqual(rendered, '角色：林岚，目标：');
    });
});
