// src/utils/githubUtils.ts
// hope that params and the description of functions will help yall!!

/**
 * Replaces placeholders in a template string with provided variables.
 * @param template The string template containing placeholders like $DELAY.
 * @param vars An object mapping placeholder keys to their replacement values.
 * @returns The string with placeholders replaced.
 */
export function replaceVars(
  template: string,
  vars: Record<string, string>
): string {
  return template.replace(/\$(\w+)/g, (_, key) => vars[key] || "");
}

/**
 * Extracts repository and issue/PR number data from the webhook context.
 * It checks both the `issue` and `pull_request` properties so that events on either work correctly.
 *
 * @param context - The webhook event context.
 * @returns An object with { owner, repo, issue_number }.
 */
export function getRepoAndIssueData(context: any) {
  const repository = context.payload.repository || {};
  const owner = repository.owner && repository.owner.login;
  const repo = repository.name;

  let issue_number = undefined;
  if (context.payload.issue && context.payload.issue.number) {
    issue_number = context.payload.issue.number;
  } else if (
    context.payload.pull_request &&
    context.payload.pull_request.number
  ) {
    issue_number = context.payload.pull_request.number;
  } else {
    console.warn(
      "Cannot determine issue/pull request number from payload:",
      context.payload
    );
  }

  return { owner, repo, issue_number };
}
