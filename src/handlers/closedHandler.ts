// src/handlers/closedHandler.ts
import { Octokit } from '@octokit/rest';
import { getRepoAndIssueData } from '../utils/githubUtils';

/**
 * Handles actions triggered after an issue or pull request is closed.
 * @param context The webhook context for 'issues.closed' or 'pull_request.closed' events.
 * @param octokit The Octokit instance for GitHub API interactions.
 * @param botConfig The bot's configuration object.
 */
export async function handleClosedAction(
    context: any,
    octokit: Octokit,
    botConfig: any
) {
    const { owner, repo, issue_number } = getRepoAndIssueData(context);
    const payload = context.payload;

    // 1. Verify closed state
    if (
        !issue_number ||
        (payload.issue?.state !== 'closed' &&
            payload.pull_request?.state !== 'closed')
    ) {
        return;
    }

    // 2. Process lock actions
    if (botConfig.closes?.length) {
        for (const closeAction of botConfig.closes) {
            if (closeAction.action !== 'lock') continue;

            try {
                console.log(`[Lock] Attempting to lock #${issue_number}`);

                await octokit.issues.lock({ owner, repo, issue_number });
                console.log(`[Lock] Successfully locked #${issue_number}`);

                if (closeAction.comment) {
                    await octokit.issues.createComment({
                        owner,
                        repo,
                        issue_number,
                        body: closeAction.comment
                    });
                }
            } catch (error) {
                const msg = (error instanceof Error) ? error.message : String(error);
                console.error(`[Lock] Failed for #${issue_number}:`, msg);
            }
        }
    }
}
