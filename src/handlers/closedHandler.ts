// src/handlers/closedHandler.ts
// hope that params and the description of functions will help yall!!
import { Octokit } from '@octokit/rest';
import msImport from 'ms';
import { getRepoAndIssueData } from '../utils/githubUtils';

const ms = msImport as unknown as (value: string) => number;

/**
 * Handles actions triggered after an issue or pull request is closed.
 * @param context The webhook context for 'issues.closed' or 'pull_request.closed' events.
 * @param octokit The Octokit instance for GitHub API interactions.
 * @param botConfig The bot's configuration object.
 */
export async function handleClosedAction(context: any, octokit: Octokit, botConfig: any) {
    const { owner, repo, issue_number } = getRepoAndIssueData(context);
    const payload = context.payload;

    // Skip if not fully closed (e.g., draft PRs)
    if (payload.issue?.state_reason !== 'completed' && 
        payload.pull_request?.merged !== true) return;

    for (const closeAction of botConfig.closes || []) {
        if (closeAction.action !== 'lock') continue;

        const delay = ms(closeAction.delay || '0s');
        const comment = closeAction.comment;

        setTimeout(async () => {
            try {
                // 1. Lock first (more critical)
                await octokit.issues.lock({ owner, repo, issue_number });

                // 2. Add comment if configured
                if (comment) {
                    await octokit.issues.createComment({
                        owner, repo, issue_number,
                        body: comment.replace('$DELAY', closeAction.delay)
                    });
                }

                console.log(`[Locked] #${issue_number} after ${closeAction.delay}`);
            } catch (error) {
                const msg = (error instanceof Error) ? error.message : String(error);
                console.error(`[Lock Failed] #${issue_number}:`, msg);
                // Retry once after 1 min
                setTimeout(() => octokit.issues.lock({ owner, repo, issue_number }), 60000);
            }
        }, delay);
    }
}