// src/handlers/closedHandler.ts
// hope that params and the description of functions will help yall!!
import { Octokit } from '@octokit/rest';
import ms from 'ms';
import { getRepoAndIssueData } from '../utils/githubUtils';

/**
 * Handles actions triggered after an issue or pull request is closed.
 * @param context The webhook context for 'issues.closed' or 'pull_request.closed' events.
 * @param octokit The Octokit instance for GitHub API interactions.
 * @param botConfig The bot's configuration object.
 */
export async function handleClosedAction(context: any, octokit: Octokit, botConfig: any) {
    const { owner, repo, issue_number } = getRepoAndIssueData(context);

    if (!issue_number) {
        console.warn(`Could not find issue/pull request number for closed action.`);
        return;
    }

    console.log(`[+] Issue/PR #${issue_number} was closed. Checking closed actions.`);

    if (botConfig.closes && Array.isArray(botConfig.closes)) {
        for (const closeAction of botConfig.closes) {
            const delay = closeAction.delay || '0s';
            const wait = typeof delay === 'string' ? ms(delay) : delay;

            console.log(`[+] Scheduled ${closeAction.action} for issue/PR #${issue_number} in ${wait}ms.`);

            setTimeout(async () => {
                try {
                    if (closeAction.action === 'lock') {
                        // lock the conversation on the issue/pull request
                        await octokit.issues.lock({
                            owner,
                            repo,
                            issue_number,
                            lock_reason: 'resolved', // idk maybe change to the closed just closed not resolved
                        });
                        console.log(`[Action] Locked issue/PR #${issue_number}.`);
                    } else {
                        console.warn(`Unsupported close action "${closeAction.action}".`);
                    }
                } catch (error: any) {
                    console.error(`Error handling close action for #${issue_number}:`, error.message);
                }
            }, wait);
        }
    }
}
