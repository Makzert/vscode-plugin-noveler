import * as http from 'http';
import * as https from 'https';
import { URL } from 'url';
import { Logger } from '../utils/logger';
import { ChatCompletionResponse, LLMConfig, LLMMessage, ModelOptions } from './types';

export class LLMClient {
    public constructor(
        private readonly getConfig: () => LLMConfig | undefined
    ) {}

    public async generate(prompt: string, options?: ModelOptions): Promise<string> {
        return this.generateMessages([
            { role: 'system', content: options?.systemPrompt ?? '你是一个专业的中文小说写作助手。' },
            { role: 'user', content: prompt }
        ], options);
    }

    public getConfigSnapshot(): LLMConfig | undefined {
        return this.getConfig();
    }

    public async generateMessages(messages: LLMMessage[], options?: ModelOptions): Promise<string> {
        const config = this.getConfig();
        if (!config?.apiKey || !config.baseUrl || !config.model) {
            throw new Error('AI 配置不完整，请在 novel.jsonc 的 noveler.ai 中配置 baseUrl、apiKey、model，或设置环境变量 NOVELER_OPENAI_BASE_URL、NOVELER_OPENAI_API_KEY、NOVELER_OPENAI_MODEL。');
        }

        const endpoint = this.resolveEndpoint(config.baseUrl);
        const payload = {
            model: options?.model ?? config.model,
            messages,
            temperature: options?.temperature ?? config.temperature,
            max_tokens: options?.maxTokens ?? config.maxTokens,
            stream: options?.stream === true
        };

        Logger.info('[AI] 发送 LLM 请求', {
            endpoint: endpoint.toString(),
            model: payload.model,
            stream: payload.stream
        });

        const raw = await this.sendRequest(
            endpoint,
            payload,
            config.apiKey,
            options?.timeoutMs ?? config.timeoutMs ?? 60000,
            options?.onToken
        );
        return payload.stream ? this.parseStreamingResponse(raw) : this.parseJsonResponse(raw);
    }

    private resolveEndpoint(baseUrl: string): URL {
        const normalized = baseUrl.endsWith('/chat/completions')
            ? baseUrl
            : `${baseUrl.replace(/\/$/, '')}/chat/completions`;

        return new URL(normalized);
    }

    private sendRequest(
        endpoint: URL,
        payload: Record<string, unknown>,
        apiKey: string,
        timeoutMs: number,
        onToken?: (chunk: string, accumulated: string) => void
    ): Promise<string> {
        const body = JSON.stringify(payload);
        const client = endpoint.protocol === 'https:' ? https : http;

        return new Promise((resolve, reject) => {
            const req = client.request(endpoint, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Content-Length': Buffer.byteLength(body),
                    Authorization: `Bearer ${apiKey}`
                }
            }, (res) => {
                const chunks: Buffer[] = [];
                let sseBuffer = '';
                let streamedText = '';

                res.on('data', (chunk) => {
                    const bufferChunk = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
                    chunks.push(bufferChunk);

                    if (payload.stream === true && onToken) {
                        sseBuffer += bufferChunk.toString('utf8');
                        const segments = sseBuffer.split('\n');
                        sseBuffer = segments.pop() ?? '';

                        for (const rawLine of segments) {
                            const line = rawLine.trim();
                            if (!line.startsWith('data: ')) {
                                continue;
                            }

                            const data = line.slice('data: '.length);
                            if (data === '[DONE]') {
                                continue;
                            }

                            try {
                                const parsed = JSON.parse(data) as ChatCompletionResponse;
                                const token = parsed.choices?.[0]?.delta?.content;
                                if (token) {
                                    streamedText += token;
                                    onToken(token, streamedText);
                                }
                            } catch (error) {
                                Logger.warn('[AI] 解析流式响应片段失败', error, data);
                            }
                        }
                    }
                });

                res.on('end', () => {
                    const responseText = Buffer.concat(chunks).toString('utf8');
                    if (res.statusCode && res.statusCode >= 400) {
                        reject(new Error(`LLM 请求失败 (${res.statusCode}): ${responseText}`));
                        return;
                    }

                    resolve(responseText);
                });
            });

            req.setTimeout(timeoutMs, () => {
                req.destroy(new Error(`LLM 请求超时 (${timeoutMs}ms)`));
            });

            req.on('error', reject);
            req.write(body);
            req.end();
        });
    }

    private parseJsonResponse(raw: string): string {
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

    private parseStreamingResponse(raw: string): string {
        const lines = raw
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.startsWith('data: '));

        const chunks: string[] = [];
        for (const line of lines) {
            const data = line.slice('data: '.length);
            if (data === '[DONE]') {
                continue;
            }

            try {
                const parsed = JSON.parse(data) as ChatCompletionResponse;
                const chunk = parsed.choices?.[0]?.delta?.content;
                if (chunk) {
                    chunks.push(chunk);
                }
            } catch (error) {
                Logger.warn('[AI] 解析流式响应片段失败', error, data);
            }
        }

        const content = chunks.join('').trim();
        if (!content) {
            throw new Error('流式响应中未解析到内容');
        }

        return content;
    }
}
