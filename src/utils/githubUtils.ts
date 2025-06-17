// src/utils/githubUtils.ts
// hope that params and the description of functions will help yall!!

/**
 * Replaces placeholders in a template string with provided variables.
 * @param template The string template containing placeholders like $DELAY.
 * @param vars An object mapping placeholder keys to their replacement values.
 * @returns The string with placeholders replaced.
 */
export function replaceVars(template: string, vars: Record<string, string>): string {
    return template.replace(/\$(\w+)/g, (_, key) => vars[key] || '');
}

/**
 * Extracts owner, repo, and issue/pull request number from the webhook context.
 * @param context The webhook context object.
 * @returns An object containing owner, repo, and issue_number (which can be a pull_number).
 */
export function getRepoAndIssueData(context: any) {
    const owner = (context.payload as any).repository.owner.login;
    const repo = (context.payload as any).repository.name;
    // Prioritize pull request number if available, otherwise issue number
    const issue_number = (context.payload as any).pull_request?.number || (context.payload as any).issue?.number;
    return { owner, repo, issue_number };
}
