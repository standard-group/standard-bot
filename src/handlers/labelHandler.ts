// src/handlers/labelHandler.ts
// hope that params and the description of functions will help yall!!
import { Octokit } from '@octokit/rest';
// @ts-ignore
import msImport from 'ms';
import { replaceVars, getRepoAndIssueData } from '../utils/githubUtils';

const ms = msImport as unknown as (value: string) => number;

/**
 * Handles actions triggered by labels being added to issues or pull requests.
 * @param context The webhook context for 'issues.labeled' or 'pull_request.labeled' events.
 * @param octokit The Octokit instance for GitHub API interactions.
 * @param botConfig The bot's configuration object.
 */
export async function handleLabelAction(context: any, octokit: Octokit, botConfig: any) {
    const label = (context.payload as any).label.name;
    const config = botConfig.labels?.[label]; // get config

    if (!config) {
        console.log(`No specific config for label "${label}".`);
        return; // no config BOOO
    }

    // what action
    const { action, delay = botConfig.default?.[typeof config === 'string' ? config : config.action]?.delay || '0s', comment, message } =
        typeof config === 'string' ? { action: config } : config;

    const wait = ms(typeof delay === 'string' ? delay : String(delay)) ?? 0;

    console.log(`[+] Scheduled ${action} for label "${label}" in ${wait}ms`);

    // schedule the action after the specified delay
    setTimeout(async () => {
        const { owner, repo, issue_number } = getRepoAndIssueData(context);

        if (!issue_number) {
            console.warn(`Could not find issue/pull request number for label action on ${label}.`);
            return;
        }

        try {
            if (action === 'close') {
                // post a comment if 'comment' is not explicitly set to false
                if (comment !== false) {
                    const body = replaceVars(comment || botConfig.default?.close?.comment, {
                        DELAY: delay,
                        LABEL: label,
                    });
                    await octokit.issues.createComment({ owner, repo, issue_number, body });
                }
                // close the issue/pull request
                await octokit.issues.update({ owner, repo, issue_number, state: 'closed' });
                console.log(`[Action] Closed issue/PR #${issue_number} due to label "${label}".`);
            } else if (action === 'open') {
                // open the issue/pull request
                await octokit.issues.update({ owner, repo, issue_number, state: 'open' });
                console.log(`[Action] Opened issue/PR #${issue_number} due to label "${label}".`);
            } else if (action === 'comment') {
                // post a comment with a specific message
                const body = message || '';
                if (body) {
                    const parsed = replaceVars(body, { DELAY: delay, LABEL: label });
                    await octokit.issues.createComment({ owner, repo, issue_number, body: parsed });
                    console.log(`[Action] Commented on issue/PR #${issue_number} due to label "${label}".`);
                }
            } else if (action === 'merge') {
                // merge the pull request
                // note: octokit.pulls.merge requires pull_number, which is issue_number here
                await octokit.pulls.merge({ owner, repo, pull_number: issue_number });
                console.log(`[Action] Merged pull request #${issue_number} due to label "${label}".`);
            } else {
                console.warn(`Unsupported action "${action}" for label "${label}".`);
            }
        } catch (error: any) {
            console.error(`Error handling label action for "${label}" on #${issue_number}:`, error.message);
        }
    }, wait);
}

