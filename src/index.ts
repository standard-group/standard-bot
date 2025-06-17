// src/index.ts
import express from 'express';
import { Webhooks } from '@octokit/webhooks';
import { Octokit } from '@octokit/rest';
import dotenv from 'dotenv';
import yaml from 'js-yaml';
import fs from 'fs';

import { handleLabelAction } from './handlers/labelHandler';
import { handlePullRequestClosed } from './handlers/mergeHandler';
import { handleCommentAction } from './handlers/commentHandler';
import { handlePullRequestSynchronize } from './handlers/commitHandler';
import { handleClosedAction } from './handlers/closedHandler';


dotenv.config();

const app = express();
app.use(express.json()); // middleware

// octokit for GitHub API interactions with webhooks
const octokit = new Octokit({ auth: process.env.GITHUB_TOKEN });
const webhooks = new Webhooks({ secret: process.env.WEBHOOK_SECRET || 'changeme' });

const configPath = '.github/standard.yaml';
let botConfig: any = {};

try {
    const configRaw = fs.readFileSync(configPath, 'utf8');
    botConfig = yaml.load(configRaw);
    console.log('Bot configuration loaded successfully.');
} catch (err) {
    console.error(`Failed to load config: ${err}`);
    process.exit(1);
}

webhooks.on('issues.labeled', (context) => handleLabelAction(context, octokit, botConfig));
webhooks.on('pull_request.labeled', (context) => handleLabelAction(context, octokit, botConfig));
webhooks.on('pull_request.closed', (context) => handlePullRequestClosed(context, octokit, botConfig));
webhooks.on('issue_comment.created', (context) => handleCommentAction(context, octokit, botConfig));
webhooks.on('pull_request_review_comment.created', (context) => handleCommentAction(context, octokit, botConfig));
webhooks.on('pull_request.synchronize', (context) => handlePullRequestSynchronize(context, octokit, botConfig));
webhooks.on('issues.closed', (context) => handleClosedAction(context, octokit, botConfig));
webhooks.on('pull_request.closed', (context) => handleClosedAction(context, octokit, botConfig));

app.post('/webhook', (req, res) => {
    webhooks.verifyAndReceive({
        id: req.headers['x-github-delivery'] as string,
        name: req.headers['x-github-event'] as string,
        payload: req.body,
        signature: req.headers['x-hub-signature-256'] as string || req.headers['x-hub-signature'] as string,
    })
    .then(() => res.status(200).end())
    .catch(err => {
        console.error('Webhook error:', err);
        res.status(500).end();
    });
});

// start the express server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Bot is listening on port ${PORT}`));

