import { LLMConfig } from './types';

export type ModelTier = 'high' | 'medium' | 'low';

export class ModelRouter {
    public resolveModel(config: LLMConfig | undefined, tier: ModelTier): string | undefined {
        if (!config) {
            return undefined;
        }

        const tiers = config.models;
        switch (tier) {
            case 'high':
                return tiers?.high || config.model;
            case 'medium':
                return tiers?.medium || tiers?.high || config.model;
            case 'low':
                return tiers?.low || tiers?.medium || tiers?.high || config.model;
        }
    }
}
