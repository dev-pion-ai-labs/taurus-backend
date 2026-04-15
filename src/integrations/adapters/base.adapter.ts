import { IntegrationProvider } from '@prisma/client';
import {
  DecryptedCredentials,
  ConnectionTestResult,
  Resource,
  DeploymentAction,
  DryRunResult,
  ExecutionResult,
  RollbackResult,
} from './types';

export interface DeploymentAdapter {
  readonly provider: IntegrationProvider;

  /** Verify the stored credentials are still valid */
  testConnection(credentials: DecryptedCredentials): Promise<ConnectionTestResult>;

  /** List existing resources of a given type (e.g. "channels", "repos") */
  listResources(credentials: DecryptedCredentials, type: string): Promise<Resource[]>;

  /** Get a single resource by type and id */
  getResource(credentials: DecryptedCredentials, type: string, id: string): Promise<Resource>;

  /** Preview what an action will do without side effects */
  dryRun(credentials: DecryptedCredentials, action: DeploymentAction): Promise<DryRunResult>;

  /** Execute an action against the external API */
  execute(credentials: DecryptedCredentials, action: DeploymentAction): Promise<ExecutionResult>;

  /** Undo a previously executed action using stored rollback data */
  rollback(credentials: DecryptedCredentials, auditLogId: string, rollbackData: Record<string, unknown>): Promise<RollbackResult>;
}

/** Token for injecting the adapter registry map */
export const DEPLOYMENT_ADAPTERS = Symbol('DEPLOYMENT_ADAPTERS');
