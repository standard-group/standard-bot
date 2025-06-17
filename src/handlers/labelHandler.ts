// src/handlers/labelHandler.ts
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
export async function handleLabelAction(
    context: any,
    octokit: Octokit,
    botConfig: any
) {
    let label: string = (context.payload as any).label?.name;
    if (!label) {
        console.log("No label found in webhook payload.");
        return;
    }

    label = label.toLowerCase();

    const config = botConfig.labels?.[label];
    if (!config) {
        console.log(`No specific config for label "${label}".`);
        return;
    }

    const { action, delay = botConfig.default?.[typeof config === 'string' ? config : config.action]?.delay || '0s', comment, message } =
        typeof config === 'string' ? { action: config } : config;

    const wait = ms(typeof delay === 'string' ? delay : String(delay)) ?? 0;

    console.log(`[+] Scheduled ${action} for label "${label}" in ${wait}ms`);

    await new Promise((resolve) => setTimeout(resolve, wait));

    const owner = context.payload.repository?.owner?.login;
    const repo = context.payload.repository?.name;
    const issue_number = context.payload.issue?.number;

    if (!issue_number) {
        console.warn(`Could not determine the issue/pull request number for label "${label}".`);
        return;
    }

    try {
        if (action === 'comment') {
            const body = message || '';
            if (body) {
                const parsed = replaceVars(body, { DELAY: delay, LABEL: label });
                await octokit.issues.createComment({ owner, repo, issue_number, body: parsed });
                console.log(`[Action] Commented on issue/PR #${issue_number} due to label "${label}".`);
            }
        } else if (action === 'close') {
            if (comment !== false) {
                const body = replaceVars(comment || botConfig.default?.close?.comment, { DELAY: delay, LABEL: label });
                await octokit.issues.createComment({ owner, repo, issue_number, body });
            }
            await octokit.issues.update({ owner, repo, issue_number, state: 'closed' });
            console.log(`[Action] Closed issue/PR #${issue_number} due to label "${label}".`);
        } else if (action === 'open') {
            await octokit.issues.update({ owner, repo, issue_number, state: 'open' });
            console.log(`[Action] Opened issue/PR #${issue_number} due to label "${label}".`);
        } else if (action === 'merge') {
            await octokit.pulls.merge({ owner, repo, pull_number: issue_number });
            console.log(`[Action] Merged pull request #${issue_number} due to label "${label}".`);
        } else {
            console.warn(`Unsupported action "${action}" for label "${label}".`);
        }
    } catch (error: any) {
        console.error(`Error handling label action for "${label}" on #${issue_number}:`, error.message);
    }
}
