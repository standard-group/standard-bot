// src/handlers/mergeHandler.ts
// hope that params and the description of functions will help yall!!
import { Octokit } from '@octokit/rest';
import { getRepoAndIssueData } from '../utils/githubUtils';

/**
 * Handles actions triggered after a pull request is closed (e.g., merged).
 * @param context The webhook context for 'pull_request.closed' events.
 * @param octokit The Octokit instance for GitHub API interactions.
 * @param botConfig The bot's configuration object.
 */
export async function handlePullRequestClosed(context: any, octokit: Octokit, botConfig: any) {
    const { owner, repo, issue_number: pull_number } = getRepoAndIssueData(context);

    if (!pull_number || !(context.payload as any).pull_request.merged) {
        // only proceed if it's a pull request and it was actually merged
        return;
    }

    console.log(`[+] Pull Request #${pull_number} was merged. Checking merge actions.`);

    if (botConfig.merges && Array.isArray(botConfig.merges)) {
        for (const mergeAction of botConfig.merges) {
            try {
                if (mergeAction.action === 'delete_branch') {
                    const headRef = (context.payload as any).pull_request.head.ref;
                    await octokit.git.deleteRef({
                        owner,
                        repo,
                        ref: `heads/${headRef}`, // ref format for branches
                    });
                    console.log(`[Action] Deleted branch "${headRef}" after merging PR #${pull_number}.`);
                } else if (mergeAction.action === 'tag') {
                    const sha = (context.payload as any).pull_request.merge_commit_sha;
                    // simple tag name
                    const tagName = `v${new Date().getFullYear()}.${new Date().getMonth() + 1}.${new Date().getDate()}-${pull_number}`;
                    const tagMessage = `Merged PR #${pull_number}`;

                    // create a tag object
                    const createTagResponse = await octokit.git.createTag({
                        owner,
                        repo,
                        tag: tagName,
                        message: tagMessage,
                        object: sha,
                        type: 'commit',
                    });

                    // create a ref for the tag
                    await octokit.git.createRef({
                        owner,
                        repo,
                        ref: `refs/tags/${tagName}`, // ref format for tags
                        sha: createTagResponse.data.sha, // use the SHA of the created tag object
                    });
                    console.log(`[Action] Created tag "${tagName}" for merged PR #${pull_number}.`);
                } else {
                    console.warn(`Unsupported merge action "${mergeAction.action}".`);
                }
            } catch (error: any) {
                console.error(`Error handling merge action "${mergeAction.action}" for PR #${pull_number}:`, error.message);
            }
        }
    }
}
