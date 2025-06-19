// src/handlers/mergeHandler.ts
import { Octokit } from '@octokit/rest';
import { getRepoAndIssueData } from '../utils/githubUtils';

/**
 * Handles actions triggered by pull request closed events for merged PRs.
 * This handler looks up the "merges" configuration in the botConfig and performs
 * actions like deleting the branch and/or creating a tag for the merged PR.
 *
 * @param context - The webhook context for 'pull_request.closed' events.
 * @param octokit - The Octokit instance for GitHub API interactions.
 * @param botConfig - The bot's configuration object.
 */
export async function handlePullRequestClosed(
    context: any,
    octokit: Octokit,
    botConfig: any
) {
    const payload = context.payload;
    const { owner, repo, issue_number } = getRepoAndIssueData(context);

    const pr = payload.pull_request;
    const wipPattern = /\bWIP\b/i;
    if (pr && (wipPattern.test(pr.title) || pr.labels.some((l: any) => l.name.toLowerCase() === 'wip'))) {
        console.log(`[Blocked] PR #${issue_number} has WIP marker. Merge actions aborted.`);
        await octokit.repos.createCommitStatus({
            owner,
            repo,
            sha: pr.head.sha,
            state: 'failure',
            context: 'standard-bot/wip',
            description: `Blocked by WIP marker`
        });
        return; // Exit handler completely
    }

    if (!pr?.merged) {
        console.log(`PR #${issue_number} closed without merging. Skipping merge actions.`);
        return;
    }
    
    const labels = payload.pull_request.labels?.map((l: any) => l.name.toLowerCase()) || [];
    const blockedLabels = Object.entries(botConfig.labels || {})
        .filter(([label, cfg]) => {
            const action = typeof cfg === 'string' ? cfg : (cfg as any).action;
            return action === 'block_merge' && labels.includes(label);
        })
        .map(([label]) => label);

    if (blockedLabels.length > 0) {
        console.log(`[Blocked] PR #${issue_number} has blocking labels: ${blockedLabels.join(', ')}. Merge actions aborted.`);
        return;  // Do not proceed with post-merge actions (like branch deletion)
    }

    console.log(`[+] PR #${issue_number} was merged. Checking merge actions.`);

    if (botConfig.merges && Array.isArray(botConfig.merges)) {
        for (const mergeAction of botConfig.merges) {
            if (mergeAction.action === 'delete_branch') {
                const branch = payload.pull_request.head.ref;

                // Don't delete base branch
                if (branch === payload.pull_request.base.ref) {
                    console.log(`Skipping deletion of base branch "${branch}" for PR #${issue_number}.`);
                    continue;
                }

                // Skip protected branches
                const protectedPatterns = mergeAction.unless?.branches ?? [];
                const isProtected = protectedPatterns.some((pattern: string) =>
                    new RegExp(`^${pattern.replace(/\*/g, '.*')}$`).test(branch)
                );
                if (isProtected) {
                    console.log(`[skip] Branch "${branch}" matches protected pattern. Skipping deletion.`);
                    continue;
                }

                try {
                    await octokit.git.deleteRef({
                        owner,
                        repo,
                        ref: `heads/${branch}`,
                    });
                    console.log(`[Action] Deleted branch "${branch}" for merged PR #${issue_number}.`);
                } catch (err: any) {
                    console.error(`Error deleting branch "${branch}" for PR #${issue_number}: ${err.message}`);
                }
            } else if (mergeAction.action === 'tag') {
                const mergeCommitSha = payload.pull_request.merge_commit_sha;
                if (!mergeCommitSha) {
                    console.warn(`No merge commit sha found for PR #${issue_number}; cannot create tag.`);
                    continue;
                }

                // Format date as YYYY-DD-MM
                const now = new Date();
                const tagName = `${now.getFullYear()}-${String(now.getDate()).padStart(2, '0')}-${String(now.getMonth() + 1).padStart(2, '0')}-m-${issue_number}`;

                try {
                    const iso = now.toISOString();
                    await octokit.git.createTag({
                        owner,
                        repo,
                        tag: tagName,
                        message: `Tag created for merged PR #${issue_number}`,
                        object: mergeCommitSha,
                        type: 'commit',
                        tagger: {
                            name: 'standard-github-robot',
                            email: 'bot@standardgroup.dedyn.io',
                            date: iso,
                        },
                    });
                    await octokit.git.createRef({
                        owner,
                        repo,
                        ref: `refs/tags/${tagName}`,
                        sha: mergeCommitSha,
                    });
                    console.log(`[Action] Created tag "${tagName}" for merged PR #${issue_number}.`);
                } catch (err: any) {
                    console.error(`Error creating tag for PR #${issue_number}: ${err.message}`);
                }
            } else {
                console.warn(`Unsupported merge action "${mergeAction.action}" for PR #${issue_number}.`);
            }
        }
    }
}
