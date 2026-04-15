import { IntegrationProvider } from '@prisma/client';

// ─── Credential Types ────────────────────────────────────

export interface DecryptedCredentials {
  accessToken?: string;
  refreshToken?: string;
  apiKey?: string;
  bearerToken?: string;
  /** Provider-specific extra fields (e.g. team_id for Slack, installation_id for GitHub) */
  extra?: Record<string, unknown>;
}

// ─── Resource Types ──────────────────────────────────────

export interface Resource {
  id: string;
  type: string;
  name: string;
  metadata?: Record<string, unknown>;
}

// ─── Action Types ────────────────────────────────────────

export interface DeploymentAction {
  type: string; // "create_channel", "create_webhook", etc.
  provider: IntegrationProvider;
  params: Record<string, unknown>;
}

// ─── Result Types ────────────────────────────────────────

export interface ConnectionTestResult {
  success: boolean;
  message: string;
  metadata?: Record<string, unknown>; // e.g. workspace name, bot info
}

export interface DryRunResult {
  valid: boolean;
  preview: string; // Human-readable description of what will happen
  warnings: string[];
  existingConflicts?: Resource[]; // Resources that already exist and would conflict
}

export interface ExecutionResult {
  success: boolean;
  resourceId?: string;
  resourceUrl?: string;
  rollbackData: Record<string, unknown>; // Data needed to undo this action
  metadata?: Record<string, unknown>;
}

export interface RollbackResult {
  success: boolean;
  message: string;
}
