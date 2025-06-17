// src/handlers/mergeHandler.ts
// testing the merge
import { Octokit } from '@octokit/rest';
import { getRepoAndIssueData } from '../utils/githubUtils';

/**
 * Handles actions triggered by pull request closed events for merged PRs.
 * This handler looks up the “merges” configuration in the botConfig and performs
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

    // only proceed if the PR was merged
    if (!payload.pull_request?.merged) {
        console.log(`PR #${issue_number} closed without merging. Skipping merge actions.`);
        return;
    }

    console.log(`[+] PR #${issue_number} was merged. Checking merge actions.`);

    if (botConfig.merges && Array.isArray(botConfig.merges)) {
        // loop through each merge action specified in the configuration
        for (const mergeAction of botConfig.merges) {
            if (mergeAction.action === 'delete_branch') {
                const branch = payload.pull_request.head.ref;
                // make sure we don't try to delete the base branch
                if (branch === payload.pull_request.base.ref) {
                    console.log(`Skipping deletion of base branch "${branch}" for PR #${issue_number}.`);
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
                // create a tag name using the PR number and the first 7 characters of the merge commit SHA
                const tagName = `merged-${issue_number}-${mergeCommitSha.substring(0, 7)}`;
                try {
                    const now = new Date().toISOString();
                    await octokit.git.createTag({
                        owner,
                        repo,
                        tag: tagName,
                        message: `Tag created for merged PR #${issue_number}`,
                        object: mergeCommitSha,
                        type: 'commit',
                        tagger: {
                            name: 'github-bot',
                            email: 'bot@example.com',
                            date: now,
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
