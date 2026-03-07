import * as assert from 'assert';
import { ResponseParser } from '../../ai/ResponseParser';

suite('ResponseParser Test Suite', () => {
    test('should parse json response with string content and trim result', () => {
        const parser = new ResponseParser();
        const result = parser.parseJsonResponse(JSON.stringify({
            choices: [
                {
                    message: {
                        content: '  hello world  '
                    }
                }
            ]
        }));

        assert.strictEqual(result, 'hello world');
    });

    test('should parse json response with array content', () => {
        const parser = new ResponseParser();
        const result = parser.parseJsonResponse(JSON.stringify({
            choices: [
                {
                    message: {
                        content: [
                            { text: '片段A' },
                            { text: '片段B' }
                        ]
                    }
                }
            ]
        }));

        assert.strictEqual(result, '片段A片段B');
    });

    test('should throw when api error exists', () => {
        const parser = new ResponseParser();
        assert.throws(() => parser.parseJsonResponse(JSON.stringify({
            error: {
                message: 'boom'
            }
        })), /boom/);
    });

    test('should parse streaming response from sse lines', () => {
        const parser = new ResponseParser();
        const raw = [
            'data: {"choices":[{"delta":{"content":"你"}}]}',
            'data: {"choices":[{"delta":{"content":"好"}}]}',
            'data: [DONE]'
        ].join('\n');

        const result = parser.parseStreamingResponse(raw);
        assert.strictEqual(result, '你好');
    });

    test('should throw when streaming response has no text chunks', () => {
        const parser = new ResponseParser();
        const raw = [
            'data: {"choices":[{"delta":{"content":""}}]}',
            'data: [DONE]'
        ].join('\n');

        assert.throws(() => parser.parseStreamingResponse(raw), /流式响应中未解析到内容/);
    });

    test('should parse single data line and ignore malformed json', () => {
        const warnings: string[] = [];
        const parser = new ResponseParser((_error, data) => {
            warnings.push(data);
        });

        assert.strictEqual(parser.parseStreamingDataLine('{"choices":[{"delta":{"content":"A"}}]}'), 'A');
        assert.strictEqual(parser.parseStreamingDataLine('[DONE]'), undefined);
        assert.strictEqual(parser.parseStreamingDataLine('{invalid json'), undefined);
        assert.strictEqual(warnings.length, 1);
    });
});
