// src/index.ts
import { Webhooks } from "@octokit/webhooks";
import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import yaml from "js-yaml";
import ms from "ms";

import { handleLabelAction } from "./handlers/labelHandler";
import { handlePullRequestClosed } from "./handlers/mergeHandler";
import { handleCommentAction } from "./handlers/commentHandler";
import { handlePullRequestSynchronize } from "./handlers/commitHandler";
import { handleClosedAction } from "./handlers/closedHandler";

const STANDARD_YAML_CONFIG = `
default:
  close:
    delay: "3 days"
    comment: "⚠️ This issue has been marked $LABEL and will be closed in $DELAY."
labels:
  duplicate:
    action: close
    delay: 15s
    comment: "Duplicate issue created! Closing in $DELAY . . ."
  invalid: close
  stale: 
    action: close
    delay: 7 days
    comment: false
  snooze:
    action: open
    delay: 7 days
  'merge when passing': merge
  wontfix:
    action: close
    delay: 15s
    comment: 'Issue was labeled as \`wontfix\`, since contributors/main'
  approved: 
    action: merge
  'new contributor':
    action: comment
    delay: 5s
    message: "Thanks for making your first contribution! :slightly_smiling_face:"
  bug:
    action: comment
    delay: 5s
    message: "Thanks for reporting this bug! Please wait until maintainer or contributors will help you. :bug:"
  remind:
    action: comment
    delay: 1d
    message: "You asked me to remind you about this $DELAY ago."
  enhancement:
    action: comment
    delay: 5s
    message: "Thank you for making an issue! If you have more something to say/add, please comment down below."
  documentation:
    action: comment
    delay: 5s
    message: "Thank you for contributing to the documentation! If you have more something to say/add, please comment down below."
merges:
  - action: delete_branch
  - action: tag
comments:
  - action: label
    pattern: /duplicate of/i
    labels: 
      - duplicate
  - action: delete_comment
    pattern: "$PROFANITY"
  - action: label
    pattern: /\\/remind/i
    labels: 
      - remind
  - action: delete_comment
    pattern: /\\/remind/i
commits:
  - action: label
    pattern: /merge when passing/i
    user: "maintainer"
    labels: 
      - merge when passing
  - action: label
    pattern: BREAKING CHANGE
    labels: 
      - Major Version
  - action: label
    pattern: /perf.+?:/
    labels: 
      - Major Version
  - action: label
    pattern: /feat.+?:/
    labels: 
      - Minor Version
  - action: label
    pattern: /fix.+?:/
    labels: 
      - Patch Version
closes:
  - action: lock
    delay: 5s
`;

let botConfig: any = {};
try {
  botConfig = yaml.load(STANDARD_YAML_CONFIG);
  console.log("Bot configuration loaded successfully from inlined YAML.");
} catch (err) {
  console.error(`Failed to parse inlined config: ${err}`);
  throw new Error("Failed to load bot configuration.");
}

/**
 * Cloudflare Worker's main `fetch` handler.
 * This function handles all incoming HTTP requests to your Worker.
 *
 * @param request The incoming Request object.
 * @param env An object containing environment variables (secrets, KV bindings etc.).
 * @param ctx The execution context for the Worker, used for `waitUntil`.
 */
export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext
  ): Promise<Response> {
    if (
      request.method !== "POST" ||
      new URL(request.url).pathname !== "/webhook"
    ) {
      return new Response("Not Found", { status: 404 });
    }

    try {
      const GITHUB_APP_ID = env.GITHUB_APP_ID;
      const GITHUB_APP_PRIVATE_KEY = env.GITHUB_APP_PRIVATE_KEY;
      const WEBHOOK_SECRET = env.WEBHOOK_SECRET;

      if (!GITHUB_APP_ID || !GITHUB_APP_PRIVATE_KEY || !WEBHOOK_SECRET) {
        console.error(
          "Missing required environment variables (GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, or WEBHOOK_SECRET)."
        );
        return new Response("Server Configuration Error", { status: 500 });
      }

      const appAuth = createAppAuth({
        appId: GITHUB_APP_ID,
        privateKey: GITHUB_APP_PRIVATE_KEY,
      });

      const webhooks = new Webhooks({ secret: WEBHOOK_SECRET });

      const rawBody = await request.text();

      const rawEventName = request.headers.get("x-github-event") || "";
      const id = request.headers.get("x-github-delivery") || "";
      const signature =
        request.headers.get("x-hub-signature-256") ||
        request.headers.get("x-hub-signature") ||
        "";

      let payload: any;
      try {
        payload = JSON.parse(rawBody);
      } catch (parseError) {
        console.error("Failed to parse payload:", parseError);
        return new Response("Invalid JSON", { status: 400 });
      }

      let eventName = rawEventName;
      if (
        (rawEventName === "issues" || rawEventName === "pull_request") &&
        payload.action
      ) {
        eventName = `${rawEventName}.${payload.action}`;
      }

      await webhooks.verifyAndReceive({
        id: id,
        name: eventName,
        payload: rawBody,
        signature: signature,
      });

      let octokit: Octokit;

      const hasRepository =
        (payload as any).repository &&
        (payload as any).repository.owner &&
        (payload as any).repository.name;

      if (eventName === "ping" || !hasRepository) {
        octokit = new Octokit({
          authStrategy: createAppAuth,
          auth: { appId: GITHUB_APP_ID, privateKey: GITHUB_APP_PRIVATE_KEY },
        });
        if (eventName === "ping") {
          console.log("Received ping event. Webhook is healthy.");
        } else {
          console.log(
            `Received event '${name}' without repository context. Authenticating as app.`
          );
        }
      } else {
        const owner = (payload as any).repository.owner.login;
        const repo = (payload as any).repository.name;

        try {
          const appOctokit = new Octokit({
            authStrategy: createAppAuth,
            auth: { appId: GITHUB_APP_ID, privateKey: GITHUB_APP_PRIVATE_KEY },
          });
          const installationResponse =
            await appOctokit.apps.getRepoInstallation({ owner, repo });
          const installationId = installationResponse.data.id;

          const installationAuth = await appAuth({
            type: "installation",
            installationId,
          });
          const installationToken = installationAuth.token;

          octokit = new Octokit({ auth: installationToken });
          console.log(
            `Authenticated as installation #${installationId} for ${owner}/${repo}.`
          );
        } catch (installError: any) {
          console.error(
            `Error getting installation token for ${owner}/${repo}:`,
            installError.message
          );
          throw new Error(
            `Failed to authenticate as installation for ${owner}/${repo}: ${installError.message}`
          );
        }
      }

      const eventHandlers: {
        [key: string]: (
          context: any,
          octokit: Octokit,
          botConfig: any
        ) => Promise<void>;
      } = {
        "issues.labeled": handleLabelAction,
        "pull_request.labeled": handleLabelAction,
        "pull_request.closed": handlePullRequestClosed,
        "issue_comment.created": handleCommentAction,
        "pull_request_review_comment.created": handleCommentAction,
        "pull_request.synchronize": handlePullRequestSynchronize,
        "issues.closed": handleClosedAction,
        ping: async () => {},
      };

      const handler = eventHandlers[eventName];
      if (handler) {
        ctx.waitUntil(
          handler({ id, name: eventName, payload }, octokit, botConfig)
        );
      } else {
        console.log(`No specific handler found for event: ${eventName}`);
      }

      return new Response("OK", { status: 200 });
    } catch (err: any) {
      console.error("Webhook processing error:", err.message);
      return new Response(`Webhook Error: ${err.message}`, { status: 500 });
    }
  },
};

interface Env {
  WEBHOOK_SECRET: string;
  GITHUB_APP_PRIVATE_KEY: string;
  GITHUB_APP_ID: string;
}

interface ExecutionContext {
  waitUntil(promise: Promise<any>): void;
}
