import { ChatCompletionResponse } from './types';

export type StreamingParseWarningHandler = (error: unknown, rawData: string) => void;

export class ResponseParser {
    public constructor(
        private readonly onStreamingParseWarning?: StreamingParseWarningHandler
    ) {}

    public parseJsonResponse(raw: string): string {
        const parsed = JSON.parse(raw) as ChatCompletionResponse;
        if (parsed.error?.message) {
            throw new Error(parsed.error.message);
        }

        const content = parsed.choices?.[0]?.message?.content;
        if (typeof content === 'string') {
            return content.trim();
        }

        if (Array.isArray(content)) {
            return content.map((item) => item.text ?? '').join('').trim();
        }

        throw new Error('LLM 返回中缺少文本内容');
    }

    public parseStreamingResponse(raw: string): string {
        const lines = raw
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.startsWith('data: '));

        const chunks: string[] = [];
        for (const line of lines) {
            const data = line.slice('data: '.length);
            const chunk = this.parseStreamingDataLine(data);
            if (chunk) {
                chunks.push(chunk);
            }
        }

        const content = chunks.join('').trim();
        if (!content) {
            throw new Error('流式响应中未解析到内容');
        }

        return content;
    }

    public parseStreamingDataLine(data: string): string | undefined {
        if (data === '[DONE]') {
            return undefined;
        }

        try {
            const parsed = JSON.parse(data) as ChatCompletionResponse;
            const chunk = parsed.choices?.[0]?.delta?.content;
            if (typeof chunk === 'string' && chunk.length > 0) {
                return chunk;
            }
        } catch (error) {
            this.onStreamingParseWarning?.(error, data);
        }

        return undefined;
    }
}
