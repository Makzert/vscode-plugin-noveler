/**
 * 配置验证工具
 */

import { NovelConfig } from '../services/configService';

export interface ValidationError {
    field: string;
    message: string;
    severity: 'error' | 'warning';
}

/**
 * 验证配置对象
 * @param config 要验证的配置对象
 * @returns 验证错误数组，如果为空则表示验证通过
 */
export function validateConfig(config: NovelConfig): ValidationError[] {
    const errors: ValidationError[] = [];

    // 验证 targetWords
    if (config.targetWords?.default !== undefined) {
        const targetWords = config.targetWords.default;
        if (typeof targetWords !== 'number') {
            errors.push({
                field: 'targetWords.default',
                message: '目标字数必须是数字',
                severity: 'error'
            });
        } else if (targetWords <= 0) {
            errors.push({
                field: 'targetWords.default',
                message: '目标字数必须大于 0',
                severity: 'error'
            });
        } else if (targetWords > 50000) {
            errors.push({
                field: 'targetWords.default',
                message: '目标字数建议不超过 50000',
                severity: 'warning'
            });
        }
    }

    // 验证 highlight 样式
    if (config.highlight) {
        for (const [type, style] of Object.entries(config.highlight)) {
            if (style.color && !isValidColor(style.color)) {
                errors.push({
                    field: `highlight.${type}.color`,
                    message: `颜色值无效：${style.color}`,
                    severity: 'warning'
                });
            }
            if (style.backgroundColor && !isValidColor(style.backgroundColor)) {
                errors.push({
                    field: `highlight.${type}.backgroundColor`,
                    message: `背景颜色值无效：${style.backgroundColor}`,
                    severity: 'warning'
                });
            }
        }
    }

    // 验证 format.chineseQuoteStyle
    if (config.format?.chineseQuoteStyle) {
        const validStyles = ['「」', '""', '""'];
        if (!validStyles.includes(config.format.chineseQuoteStyle)) {
            errors.push({
                field: 'format.chineseQuoteStyle',
                message: `引号样式无效，支持: ${validStyles.join(', ')}`,
                severity: 'warning'
            });
        }
    }

    // 验证 autoUpdateReadmeOnCreate
    if (config.autoUpdateReadmeOnCreate?.value) {
        const validValues = ['always', 'ask', 'never'];
        if (!validValues.includes(config.autoUpdateReadmeOnCreate.value)) {
            errors.push({
                field: 'autoUpdateReadmeOnCreate.value',
                message: `README 自动更新值无效，支持: ${validValues.join(', ')}`,
                severity: 'error'
            });
        }
    }

    // 验证 AI 配置
    if (config.ai) {
        if (config.ai.baseUrl !== undefined && typeof config.ai.baseUrl !== 'string') {
            errors.push({
                field: 'ai.baseUrl',
                message: 'AI baseUrl 必须是字符串',
                severity: 'error'
            });
        }

        if (config.ai.apiKey !== undefined && typeof config.ai.apiKey !== 'string') {
            errors.push({
                field: 'ai.apiKey',
                message: 'AI apiKey 必须是字符串',
                severity: 'error'
            });
        }

        if (config.ai.model !== undefined && typeof config.ai.model !== 'string') {
            errors.push({
                field: 'ai.model',
                message: 'AI model 必须是字符串',
                severity: 'error'
            });
        }

        if (config.ai.temperature !== undefined) {
            if (typeof config.ai.temperature !== 'number' || Number.isNaN(config.ai.temperature)) {
                errors.push({
                    field: 'ai.temperature',
                    message: 'AI temperature 必须是数字',
                    severity: 'error'
                });
            } else if (config.ai.temperature < 0 || config.ai.temperature > 2) {
                errors.push({
                    field: 'ai.temperature',
                    message: 'AI temperature 建议在 0 到 2 之间',
                    severity: 'warning'
                });
            }
        }

        if (config.ai.maxTokens !== undefined) {
            if (typeof config.ai.maxTokens !== 'number' || !Number.isFinite(config.ai.maxTokens)) {
                errors.push({
                    field: 'ai.maxTokens',
                    message: 'AI maxTokens 必须是数字',
                    severity: 'error'
                });
            } else if (config.ai.maxTokens <= 0) {
                errors.push({
                    field: 'ai.maxTokens',
                    message: 'AI maxTokens 必须大于 0',
                    severity: 'error'
                });
            }
        }
    }

    return errors;
}

/**
 * 验证颜色值是否有效
 * @param color 颜色字符串
 * @returns 是否有效
 */
function isValidColor(color: string): boolean {
    // 支持 hex (#fff, #ffffff), rgb, rgba
    const hexPattern = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i;
    const rgbPattern = /^rgba?\(\s*\d+\s*,\s*\d+\s*,\s*\d+\s*(,\s*[\d.]+\s*)?\)$/i;

    return hexPattern.test(color) || rgbPattern.test(color);
}

/**
 * 深拷贝对象
 * @param obj 要拷贝的对象
 * @returns 深拷贝后的对象
 */
function deepClone<T>(obj: T): T {
    if (obj === null || typeof obj !== 'object') {
        return obj;
    }
    if (Array.isArray(obj)) {
        return obj.map(item => deepClone(item)) as unknown as T;
    }
    const cloned = {} as T;
    for (const key in obj) {
        if (Object.prototype.hasOwnProperty.call(obj, key)) {
            cloned[key] = deepClone(obj[key]);
        }
    }
    return cloned;
}

/**
 * 修复配置（尽可能自动修正）
 * @param config 配置对象
 * @returns 修复后的配置对象（不修改原对象）
 */
export function fixConfig(config: NovelConfig): NovelConfig {
    // 深拷贝避免修改原对象
    const fixed = deepClone(config);

    // 修复 targetWords
    if (fixed.targetWords?.default !== undefined) {
        if (typeof fixed.targetWords.default !== 'number' || fixed.targetWords.default <= 0) {
            fixed.targetWords.default = 2500; // 恢复默认值
        }
    }

    // 修复 autoUpdateReadmeOnCreate
    if (fixed.autoUpdateReadmeOnCreate?.value) {
        const validValues = ['always', 'ask', 'never'];
        if (!validValues.includes(fixed.autoUpdateReadmeOnCreate.value)) {
            fixed.autoUpdateReadmeOnCreate.value = 'always'; // 恢复默认值
        }
    }

    if (fixed.ai) {
        if (typeof fixed.ai.baseUrl !== 'string') {
            fixed.ai.baseUrl = 'https://api.openai.com/v1';
        }
        if (typeof fixed.ai.apiKey !== 'string') {
            fixed.ai.apiKey = '';
        }
        if (typeof fixed.ai.model !== 'string') {
            fixed.ai.model = 'gpt-4.1-mini';
        }
        if (typeof fixed.ai.temperature !== 'number' || Number.isNaN(fixed.ai.temperature)) {
            fixed.ai.temperature = 0.8;
        }
        if (typeof fixed.ai.maxTokens !== 'number' || fixed.ai.maxTokens <= 0) {
            fixed.ai.maxTokens = 4000;
        }
        if (typeof fixed.ai.timeoutMs !== 'number' || fixed.ai.timeoutMs <= 0) {
            fixed.ai.timeoutMs = 60000;
        }
    }

    return fixed;
}
