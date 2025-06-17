// src/handlers/commitHandler.ts
// hope that params and the description of functions will help yall!!
import { Octokit } from '@octokit/rest';
import { getRepoAndIssueData } from '../utils/githubUtils';

/**
 * Handles actions triggered by new commits being pushed to a pull request.
 * @param context The webhook context for 'pull_request.synchronize' events.
 * @param octokit The Octokit instance for GitHub API interactions.
 * @param botConfig The bot's configuration object.
 */
export async function handlePullRequestSynchronize(context: any, octokit: Octokit, botConfig: any) {
    const { owner, repo, issue_number } = getRepoAndIssueData(context); // issue_number is pull_number here

    if (!issue_number) {
        console.warn(`Could not find pull request number for commit action.`);
        return;
    }

    console.log(`[+] Pull Request #${issue_number} synchronized. Checking commit actions.`);

    // get the commits associated with this PR update
    const commitsResponse = await octokit.pulls.listCommits({
        owner,
        repo,
        pull_number: issue_number,
    });
    const commits = commitsResponse.data;

    if (botConfig.commits && Array.isArray(botConfig.commits)) {
        for (const commitConfig of botConfig.commits) {
            let patternRegex: RegExp;
            try {
                if (typeof commitConfig.pattern === 'string' && commitConfig.pattern.startsWith('/') && commitConfig.pattern.endsWith('/i')) {
                    const parts = commitConfig.pattern.slice(1, -1).split('/');
                    const flags = parts.pop();
                    const regex = parts.join('/');
                    patternRegex = new RegExp(regex, flags);
                } else if (typeof commitConfig.pattern === 'string') {
                    // treat as literal string for regex escape
                    patternRegex = new RegExp(commitConfig.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
                } else {
                    console.warn(`Invalid pattern type for commit action: ${commitConfig.pattern}`);
                    continue;
                }
            } catch (e) {
                console.error(`Invalid regex pattern in config for commit action: ${commitConfig.pattern}`, e);
                continue;
            }

            for (const commit of commits) {
                if (patternRegex.test(commit.commit.message)) {
                    if (commitConfig.user && commitConfig.user !== commit.author?.login && commitConfig.user !== commit.committer?.login) {
                        continue; // skip if user filter is present and doesn't match
                    }

                    try {
                        if (commitConfig.action === 'label' && Array.isArray(commitConfig.labels)) {
                            // add labels to the pull request
                            await octokit.issues.addLabels({
                                owner,
                                repo,
                                issue_number,
                                labels: commitConfig.labels,
                            });
                            console.log(`[Action] Applied labels ${commitConfig.labels.join(', ')} to PR #${issue_number} from commit "${commit.sha}".`);
                        } else {
                            console.warn(`Unsupported commit action "${commitConfig.action}" or invalid labels array.`);
                        }
                    } catch (error: any) {
                        console.error(`Error handling commit action for PR #${issue_number} from commit "${commit.sha}":`, error.message);
                    }
                }
            }
        }
    }
}
