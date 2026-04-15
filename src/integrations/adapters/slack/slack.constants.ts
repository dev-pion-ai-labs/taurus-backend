/** Slack OAuth scopes required for the deployment agent */
export const SLACK_SCOPES = [
  'channels:read',
  'channels:manage',
  'channels:join',
  'incoming-webhook',
  'chat:write',
  'users:read',
];

export const SLACK_OAUTH_AUTHORIZE_URL = 'https://slack.com/oauth/v2/authorize';
export const SLACK_OAUTH_TOKEN_URL = 'https://slack.com/api/oauth.v2.access';
export const SLACK_CALLBACK_PATH = '/integrations/callback/slack';

/** Max channels the agent can create in a single deployment session */
export const MAX_CHANNELS_PER_DEPLOYMENT = 5;

/** Slack channel name rules: lowercase alphanumeric, hyphens, underscores. Max 80 chars. */
export const CHANNEL_NAME_REGEX = /^[a-z0-9][a-z0-9_-]{0,79}$/;

/** Slack message text limit */
export const MAX_MESSAGE_LENGTH = 4000;

/** Max items to fetch per list request */
export const LIST_LIMIT = 200;
