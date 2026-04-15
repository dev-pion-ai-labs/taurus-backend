/** GitHub App permissions required for the deployment agent */
export const GITHUB_APP_PERMISSIONS = {
  actions: 'write' as const,
  contents: 'write' as const,
  webhooks: 'write' as const,
  metadata: 'read' as const,
};

/** OAuth scopes for GitHub OAuth App (fallback if not using GitHub App) */
export const GITHUB_OAUTH_SCOPES = [
  'repo',
  'workflow',
  'admin:repo_hook',
  'read:org',
];

export const GITHUB_OAUTH_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
export const GITHUB_OAUTH_TOKEN_URL = 'https://github.com/login/oauth/access_token';
export const GITHUB_CALLBACK_PATH = '/integrations/callback/github';

/** Max workflows the agent can create in a single deployment session */
export const MAX_WORKFLOWS_PER_DEPLOYMENT = 5;

/** GitHub workflow filename regex: alphanumeric, hyphens, underscores, must end with .yml or .yaml */
export const WORKFLOW_FILENAME_REGEX = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,98}\.(yml|yaml)$/;

/** Max items to fetch per list request */
export const LIST_PER_PAGE = 100;
