export interface StyleProfile {
    tone: string;
    pacing: string;
    targetAudience: string;
    tabooRules: string[];
}

export const DEFAULT_STYLE_PROFILE: StyleProfile = {
    tone: '偏写实、情绪克制但有张力',
    pacing: '中快节奏，场景推进明确',
    targetAudience: '中文网络小说读者',
    tabooRules: [
        '避免无意义灌水',
        '避免现代口水化表达破坏文风',
        '避免突兀设定跳变'
    ]
};

export function buildStyleProfilePrompt(profile?: Partial<StyleProfile>): string {
    const effective: StyleProfile = {
        ...DEFAULT_STYLE_PROFILE,
        ...profile,
        tabooRules: profile?.tabooRules?.length ? profile.tabooRules : DEFAULT_STYLE_PROFILE.tabooRules
    };

    return [
        '风格档案：',
        `- 语气/基调：${effective.tone}`,
        `- 节奏：${effective.pacing}`,
        `- 目标读者：${effective.targetAudience}`,
        `- 禁忌规则：${effective.tabooRules.join('；')}`
    ].join('\n');
}
