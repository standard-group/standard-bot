import { Octokit } from "@octokit/rest";
// @ts-ignore
import msImport from "ms";
import { replaceVars, getRepoAndIssueData } from "../utils/githubUtils";

const ms = msImport as unknown as (value: string) => number;

export async function handleLabelAction(
  context: any,
  octokit: Octokit,
  botConfig: any
) {
  let labels: string[] = [];

  if (context.payload.label?.name) {
    labels.push(context.payload.label.name);
  } else if (context.payload.issue?.labels) {
    labels = context.payload.issue.labels.map((l: any) => l.name);
  } else if (context.payload.pull_request?.labels) {
    labels = context.payload.pull_request.labels.map((l: any) => l.name);
  } else {
    console.warn("No label information found in payload.");
    return;
  }

  const { owner, repo, issue_number } = getRepoAndIssueData(context);
  if (!issue_number) {
    console.warn("Could not determine the issue/PR number.");
    return;
  }

  for (const rawLabel of labels) {
    const label = rawLabel.toLowerCase();
    const config = botConfig.labels?.[label];

    if (!config) {
      console.log(`No specific config for label "${label}".`);
      continue;
    }

    const resolvedAction = typeof config === "string" ? config : config.action;
    const resolvedDelay =
      typeof config === "object" && config.delay
        ? config.delay
        : botConfig.default?.[resolvedAction]?.delay || "0s";

    const commentTemplate =
      typeof config === "object" && "comment" in config
        ? config.comment
        : botConfig.default?.[resolvedAction]?.comment;

    const message = typeof config === "object" ? config.message : undefined;

    const wait =
      typeof resolvedDelay === "string"
        ? ms(resolvedDelay) ?? 0
        : resolvedDelay;

    const performAction = async () => {
      try {
        if (resolvedAction === "close") {
          if (commentTemplate !== false && commentTemplate !== undefined) {
            const body = replaceVars(commentTemplate, {
              DELAY: resolvedDelay,
              LABEL: label,
            });
            await octokit.issues.createComment({
              owner,
              repo,
              issue_number,
              body,
            });
          }
          await octokit.issues.update({
            owner,
            repo,
            issue_number,
            state: "closed",
          });
          console.log(
            `[Action] Closed issue/PR #${issue_number} due to label "${label}".`
          );
        } else if (resolvedAction === "open") {
          await octokit.issues.update({
            owner,
            repo,
            issue_number,
            state: "open",
          });
          console.log(
            `[Action] Opened issue/PR #${issue_number} due to label "${label}".`
          );
        } else if (resolvedAction === "comment") {
          const body = message || "";
          if (body) {
            const parsed = replaceVars(body, {
              DELAY: resolvedDelay,
              LABEL: label,
            });
            await octokit.issues.createComment({
              owner,
              repo,
              issue_number,
              body: parsed,
            });
            console.log(
              `[Action] Commented on issue/PR #${issue_number} due to label "${label}".`
            );
          }
        } else if (resolvedAction === "merge") {
          const pr = context.payload.pull_request;
          if (!pr) {
            console.log(
              "[Skip] Expected pull_request payload for merge action."
            );
            return;
          }

          const baseBranch = pr.base.ref;
          const protectedBranches = botConfig.branches?.ignore || [];

          if (protectedBranches.includes(baseBranch)) {
            console.log(
              `[Skip] PR #${issue_number} targets protected branch "${baseBranch}". Merge aborted.`
            );
            return;
          }

          console.log(
            `Attempting to merge pull request #${issue_number} for label "${label}"...`
          );

          // NEW: Function to check if all required checks have passed
          const areChecksPassed = async (): Promise<boolean> => {
            try {
              // Get combined status (includes both statuses and check runs)
              const statusResponse =
                await octokit.repos.getCombinedStatusForRef({
                  owner,
                  repo,
                  ref: pr.head.sha,
                });

              // If combined state is success, all checks have passed
              if (statusResponse.data.state === "success") {
                console.log(
                  `[Status] All checks passed for PR #${issue_number}`
                );
                return true;
              }

              // If we have a failure, log details
              if (statusResponse.data.state === "failure") {
                const failedStatuses = statusResponse.data.statuses.filter(
                  (s: any) => s.state !== "success"
                );
                console.log(
                  `[Status] PR #${issue_number} has failing checks: ${failedStatuses
                    .map((s: any) => s.context)
                    .join(", ")}`
                );
                return false;
              }

              // If pending, log and return false
              console.log(
                `[Status] PR #${issue_number} has pending checks: ${
                  statusResponse.data.statuses.filter(
                    (s: any) => s.state === "pending"
                  ).length
                } pending`
              );
              return false;
            } catch (error: any) {
              console.error(
                `Error checking commit status for PR #${issue_number}: ${error.message}`
              );
              return false;
            }
          };

          // NEW: Wait for checks to pass with timeout
          const MAX_ATTEMPTS = 30; // 30 attempts
          const DELAY_BETWEEN_CHECKS = 10000; // 10 seconds
          const TIMEOUT = MAX_ATTEMPTS * DELAY_BETWEEN_CHECKS; // 5 minutes total

          let checksPassed = false;
          let attempts = 0;

          while (!checksPassed && attempts < MAX_ATTEMPTS) {
            if (attempts > 0) {
              console.log(
                `[Waiting] Check attempt ${
                  attempts + 1
                }/${MAX_ATTEMPTS} for PR #${issue_number}...`
              );
              await new Promise((r) => setTimeout(r, DELAY_BETWEEN_CHECKS));
            }

            checksPassed = await areChecksPassed();
            attempts++;
          }

          if (!checksPassed) {
            console.log(
              `[Timeout] PR #${issue_number} did not pass checks within ${
                TIMEOUT / 1000
              } seconds`
            );
            return;
          }

          // Existing merge logic with retries
          let prData;
          for (let i = 0; i < 5; i++) {
            const response = await octokit.pulls.get({
              owner,
              repo,
              pull_number: issue_number,
            });
            prData = response.data;
            if (prData.mergeable !== null) break;
            console.log(
              `[Waiting] PR #${issue_number} mergeable=${
                prData.mergeable
              }, retrying... (${i + 1}/5)`
            );
            await new Promise((r) => setTimeout(r, 2000));
          }

          if (prData?.mergeable) {
            try {
              const mergeResponse = await octokit.pulls.merge({
                owner,
                repo,
                commit_message: pr.title,
                pull_number: issue_number,
              });
              console.log(
                `[Action] Merged PR #${issue_number}:`,
                mergeResponse.data
              );

              // NEW: Remove the "merge when passing" label after successful merge
              try {
                await octokit.issues.removeLabel({
                  owner,
                  repo,
                  issue_number,
                  name: label,
                });
                console.log(
                  `[Action] Removed label "${label}" from PR #${issue_number}`
                );
              } catch (removeErr: any) {
                console.error(
                  `Error removing label "${label}" from PR #${issue_number}: ${removeErr.message}`
                );
              }
            } catch (error: any) {
              console.error(
                `Error merging PR #${issue_number}: ${error.message}`
              );
            }
          } else {
            console.warn(
              `[Failed] PR #${issue_number} is not mergeable after retries.`
            );
          }
        } else if (resolvedAction === "block_merge") {
          const pr = context.payload.pull_request;
          if (!pr) return;

          // Add failing status check to block merging
          await octokit.repos.createCommitStatus({
            owner,
            repo,
            sha: pr.head.sha,
            state: "failure",
            context: "standard-bot/wip",
            description: `Blocked by WIP label (${label})`,
          });

          if (commentTemplate) {
            const body = replaceVars(commentTemplate, {
              DELAY: resolvedDelay,
              LABEL: label,
            });
            await octokit.issues.createComment({
              owner,
              repo,
              issue_number,
              body,
            });
            console.log(
              `[Action] Commented on PR #${issue_number} blocking merge due to label "${label}".`
            );
          }

          console.log(
            `[Blocked] Merge blocked for PR #${issue_number} due to label "${label}".`
          );
          return;
        } else {
          console.warn(
            `Unsupported action "${resolvedAction}" for label "${label}".`
          );
        }
      } catch (error: any) {
        console.error(
          `Error handling label action for "${label}" on #${issue_number}:`,
          error.message
        );
      }
    };

    if (wait === 0) {
      console.log(
        `[+] Performing immediate ${resolvedAction} for label "${label}"`
      );
      await performAction();
    } else {
      console.log(
        `[+] Scheduled ${resolvedAction} for label "${label}" in ${wait}ms`
      );
      setTimeout(performAction, wait);
    }
  }
}
