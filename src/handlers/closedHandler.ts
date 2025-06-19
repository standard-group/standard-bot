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
const pendingLocks = new Map<number, NodeJS.Timeout>();

export async function handleClosedAction(
    context: any,
    octokit: Octokit,
    botConfig: any
) {
    const { owner, repo, issue_number } = getRepoAndIssueData(context);
    const payload = context.payload;

    // 1. Verify closed state
    if (!issue_number || 
        (payload.issue?.state !== 'closed' && 
         payload.pull_request?.state !== 'closed')) {
        return;
    }

    // 2. Process lock actions
    if (botConfig.closes?.length) {
        for (const closeAction of botConfig.closes) {
            if (closeAction.action !== 'lock') continue;

            const delay = typeof closeAction.delay === 'string' 
                ? ms(closeAction.delay) 
                : closeAction.delay || 0;

            console.log(`[Lock] Scheduling for #${issue_number} in ${delay}ms`);

            // Clear any existing timeout for this issue
            if (pendingLocks.has(issue_number)) {
                clearTimeout(pendingLocks.get(issue_number));
            }

            // 3. Persist the timeout
            const timeout = setTimeout(async () => {
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
                } finally {
                    pendingLocks.delete(issue_number);
                }
            }, delay);

            pendingLocks.set(issue_number, timeout);
        }
    }
}

if (process.env.KEEP_ALIVE) {
    setInterval(() => {}, 1000 * 60 * 5);
}