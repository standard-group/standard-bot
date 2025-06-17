// src/handlers/labelHandler.ts
import { Octokit } from '@octokit/rest';
// @ts-ignore
import msImport from 'ms';
import { replaceVars, getRepoAndIssueData } from '../utils/githubUtils';

const ms = msImport as unknown as (value: string) => number;

export async function handleLabelAction(
    context: any,
    octokit: Octokit,
    botConfig: any
) {
    let labels: string[] = [];

    if (context.payload.label && context.payload.label.name) {
        labels.push(context.payload.label.name);
    } else if (context.payload.issue?.labels) {
        labels = context.payload.issue.labels.map((l: any) => l.name);
    } else if (context.payload.pull_request?.labels) {
        labels = context.payload.pull_request.labels.map((l: any) => l.name);
    } else {
        console.warn('No label information found in payload.');
        return;
    }

    const { owner, repo, issue_number } = getRepoAndIssueData(context);
    if (!issue_number) {
        console.warn('Could not determine the issue/PR number.');
        return;
    }

    for (const rawLabel of labels) {
        const label = rawLabel.toLowerCase();

        const config = botConfig.labels?.[label];
        if (!config) {
            console.log(`No specific config for label "${label}".`);
            continue;
        }

        const {
            action,
            delay = botConfig.default?.[typeof config === 'string' ? config : config.action]?.delay || '0s',
            comment,
            message
        } = typeof config === 'string' ? { action: config } : config;

        const wait = typeof delay === 'string' ? ms(delay) ?? 0 : delay;

        const performAction = async () => {
            try {
                if (action === 'close') {
                    if (comment !== false) {
                        const body = replaceVars(comment || botConfig.default?.close?.comment, {
                            DELAY: delay,
                            LABEL: label,
                        });
                        await octokit.issues.createComment({ owner, repo, issue_number, body });
                    }
                    await octokit.issues.update({ owner, repo, issue_number, state: 'closed' });
                    console.log(`[Action] Closed issue/PR #${issue_number} due to label "${label}".`);

                } else if (action === 'open') {
                    await octokit.issues.update({ owner, repo, issue_number, state: 'open' });
                    console.log(`[Action] Opened issue/PR #${issue_number} due to label "${label}".`);

                } else if (action === 'comment') {
                    const body = message || '';
                    if (body) {
                        const parsed = replaceVars(body, { DELAY: delay, LABEL: label });
                        await octokit.issues.createComment({ owner, repo, issue_number, body: parsed });
                        console.log(`[Action] Commented on issue/PR #${issue_number} due to label "${label}".`);
                    }

                } else if (action === 'merge') {
                    if (!context.payload.pull_request) {
                        console.log('[Skip] Received `issues.labeled` but need `pull_request.labeled` for merge.');
                        return;
                    }

                    console.log(`Attempting to merge pull request #${issue_number} for label "${label}"...`);

                    let pr;
                    for (let i = 0; i < 5; i++) {
                        const response = await octokit.pulls.get({ owner, repo, pull_number: issue_number });
                        pr = response.data;
                        if (pr.mergeable !== null) break;
                        console.log(`[Waiting] PR #${issue_number} mergeable=${pr.mergeable}, retrying... (${i + 1}/5)`);
                        await new Promise((r) => setTimeout(r, 2000));
                    }

                    if (pr?.mergeable) {
                        const mergeResponse = await octokit.pulls.merge({ owner, repo, pull_number: issue_number });
                        console.log(`[Action] Merged PR #${issue_number}:`, mergeResponse.data);
                    } else {
                        console.warn(`[Failed] PR #${issue_number} is not mergeable after retries.`);
                    }

                } else {
                    console.warn(`Unsupported action "${action}" for label "${label}".`);
                }
            } catch (error: any) {
                console.error(`Error handling label action for "${label}" on #${issue_number}:`, error.message);
            }
        };

        if (wait === 0) {
            console.log(`[+] Performing immediate ${action} for label "${label}"`);
            await performAction();
        } else {
            console.log(`[+] Scheduled ${action} for label "${label}" in ${wait}ms`);
            setTimeout(performAction, wait);
        }
    }
}
