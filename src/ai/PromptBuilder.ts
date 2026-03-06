export interface PromptTemplateInput {
    system?: string;
    user: string;
    variables?: Record<string, string | number | boolean>;
}

export interface BuiltPrompt {
    systemPrompt?: string;
    userPrompt: string;
    combinedPrompt: string;
}

export class PromptBuilder {
    public build(input: PromptTemplateInput): BuiltPrompt {
        const systemPrompt = input.system ? this.renderTemplate(input.system, input.variables) : undefined;
        const userPrompt = this.renderTemplate(input.user, input.variables);

        return {
            systemPrompt,
            userPrompt,
            combinedPrompt: [systemPrompt, userPrompt].filter(Boolean).join('\n\n')
        };
    }

    public renderTemplate(
        template: string,
        variables: Record<string, string | number | boolean> = {}
    ): string {
        return template.replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key: string) => {
            const value = variables[key];
            return value === undefined ? '' : String(value);
        });
    }
}
