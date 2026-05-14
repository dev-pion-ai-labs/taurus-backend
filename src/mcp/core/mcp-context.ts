export type ExecutionMode = 'planning' | 'approved-execution';

export interface TenantContext {
  orgId: string;
  userId?: string;
  executionMode: ExecutionMode;
  requestId?: string;
}
