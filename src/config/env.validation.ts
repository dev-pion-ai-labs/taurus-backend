import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),
  CORS_ORIGIN: Joi.string().default('http://localhost:3001'),

  DATABASE_URL: Joi.string().required(),

  REDIS_URL: Joi.string().optional().allow(''),
  REDIS_HOST: Joi.string().allow('').default('localhost'),
  REDIS_PORT: Joi.number().allow('').default(6379),
  REDIS_PASSWORD: Joi.string().optional().allow(''),

  JWT_ACCESS_SECRET: Joi.string().required(),
  JWT_REFRESH_SECRET: Joi.string().required(),
  JWT_ACCESS_EXPIRATION: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRATION: Joi.string().default('7d'),

  RESEND_API_KEY: Joi.string().required(),
  RESEND_FROM_EMAIL: Joi.string().email().required(),

  ANTHROPIC_API_KEY: Joi.string().required(),
  ANTHROPIC_MODEL: Joi.string().default('claude-sonnet-4-6'),

  THROTTLE_TTL: Joi.number().default(60),
  THROTTLE_LIMIT: Joi.number().default(60),

  UPLOAD_DIR: Joi.string().default('./uploads'),

  CREDENTIAL_ENCRYPTION_KEY: Joi.string().min(32).optional(),

  SLACK_CLIENT_ID: Joi.string().optional(),
  SLACK_CLIENT_SECRET: Joi.string().optional(),

  GOOGLE_CLIENT_ID: Joi.string().optional(),
  GOOGLE_CLIENT_SECRET: Joi.string().optional(),

  NOTION_CLIENT_ID: Joi.string().optional(),
  NOTION_CLIENT_SECRET: Joi.string().optional(),

  JIRA_CLIENT_ID: Joi.string().optional(),
  JIRA_CLIENT_SECRET: Joi.string().optional(),

  HUBSPOT_CLIENT_ID: Joi.string().optional(),
  HUBSPOT_CLIENT_SECRET: Joi.string().optional(),

  SALESFORCE_CLIENT_ID: Joi.string().optional(),
  SALESFORCE_CLIENT_SECRET: Joi.string().optional(),

  GITHUB_APP_ID: Joi.string().optional(),
  GITHUB_PRIVATE_KEY: Joi.string().optional(),
  GITHUB_CLIENT_ID: Joi.string().optional(),
  GITHUB_CLIENT_SECRET: Joi.string().optional(),
});
