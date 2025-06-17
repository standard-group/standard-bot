// src/handlers/commentHandler.ts
// hope that params and the description of functions will help yall!!
import { Octokit } from '@octokit/rest';
import { getRepoAndIssueData } from '../utils/githubUtils';

/**
 * Handles actions triggered by new comments on issues or pull requests.
 * @param context The webhook context for 'issue_comment.created' or 'pull_request_review_comment.created' events.
 * @param octokit The Octokit instance for GitHub API interactions.
 * @param botConfig The bot's configuration object.
 */
export async function handleCommentAction(context: any, octokit: Octokit, botConfig: any) {
    const commentBody = (context.payload as any).comment.body;
    const commentId = (context.payload as any).comment.id;
    const { owner, repo, issue_number } = getRepoAndIssueData(context);

    if (!issue_number) {
        console.warn(`Could not find issue/pull request number for comment action.`);
        return;
    }

    console.log(`[+] New comment on #${issue_number}. Checking comment actions.`);

    if (botConfig.comments && Array.isArray(botConfig.comments)) {
        for (const commentConfig of botConfig.comments) {
            let patternRegex: RegExp;
            try {
                if (typeof commentConfig.pattern === 'string' && commentConfig.pattern.startsWith('/') && commentConfig.pattern.endsWith('/i')) {
                    // extract regex and flags
                    const parts = commentConfig.pattern.slice(1, -1).split('/');
                    const flags = parts.pop();
                    const regex = parts.join('/');
                    patternRegex = new RegExp(regex, flags);
                } else if (typeof commentConfig.pattern === 'string') {
                    patternRegex = new RegExp(commentConfig.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
                } else {
                    console.warn(`Invalid pattern type for comment action: ${commentConfig.pattern}`);
                    continue;
                }
            } catch (e) {
                console.error(`Invalid regex pattern in config for comment action: ${commentConfig.pattern}`, e);
                continue;
            }

            if (patternRegex.test(commentBody)) {
                try {
                    if (commentConfig.action === 'label' && Array.isArray(commentConfig.labels)) {
                        // add labels to the issue/pull request
                        await octokit.issues.addLabels({
                            owner,
                            repo,
                            issue_number,
                            labels: commentConfig.labels,
                        });
                        console.log(`[Action] Applied labels ${commentConfig.labels.join(', ')} to #${issue_number} from comment.`);
                    } else if (commentConfig.action === 'delete_comment') {
                        // delete the matching comment
                        await octokit.issues.deleteComment({
                            owner,
                            repo,
                            comment_id: commentId,
                        });
                        console.log(`[Action] Deleted comment ID ${commentId} on #${issue_number}.`);
                    } else {
                        console.warn(`Unsupported comment action "${commentConfig.action}" or invalid labels array.`);
                    }
                } catch (error: any) {
                    console.error(`Error handling comment action for #${issue_number}:`, error.message);
                }
            }
        }
    }
}
