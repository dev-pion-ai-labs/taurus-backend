/** Make.com API base URL */
export const MAKE_API_BASE = 'https://us1.make.com/api/v2';

/** Max scenarios the agent can create in a single deployment session */
export const MAX_SCENARIOS_PER_DEPLOYMENT = 5;

/** Make.com uses API key auth — no OAuth needed */
export const MAKE_AUTH_TYPE = 'API_KEY' as const;

/** Max items to fetch per list request */
export const LIST_LIMIT = 100;
