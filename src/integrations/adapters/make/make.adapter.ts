import { Injectable, Logger } from '@nestjs/common';
import { IntegrationProvider } from '@prisma/client';
import { DeploymentAdapter } from '../base.adapter';
import {
  DecryptedCredentials,
  ConnectionTestResult,
  Resource,
  DeploymentAction,
  DryRunResult,
  ExecutionResult,
  RollbackResult,
} from '../types';
import { MakeValidator } from './make.validator';
import { MAKE_API_BASE, LIST_LIMIT } from './make.constants';

@Injectable()
export class MakeAdapter implements DeploymentAdapter {
  readonly provider = IntegrationProvider.MAKE;
  private readonly logger = new Logger(MakeAdapter.name);

  private getHeaders(credentials: DecryptedCredentials): Record<string, string> {
    const token = credentials.apiKey || credentials.bearerToken;
    if (!token) {
      throw new Error('Make.com API key not found in credentials');
    }
    return {
      Authorization: `Token ${token}`,
      'Content-Type': 'application/json',
    };
  }

  private async makeRequest<T>(
    credentials: DecryptedCredentials,
    method: string,
    path: string,
    body?: unknown,
  ): Promise<T> {
    const headers = this.getHeaders(credentials);
    const url = `${MAKE_API_BASE}${path}`;

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`Make API error (${response.status}): ${errorBody}`);
    }

    return response.json() as Promise<T>;
  }

  // ─── Connection ───────────────────────────────────────

  async testConnection(credentials: DecryptedCredentials): Promise<ConnectionTestResult> {
    try {
      const data = await this.makeRequest<{ user: { name: string; email: string } }>(
        credentials,
        'GET',
        '/users/me',
      );

      return {
        success: true,
        message: `Connected as ${data.user.name} (${data.user.email})`,
        metadata: { name: data.user.name, email: data.user.email },
      };
    } catch (error) {
      return {
        success: false,
        message: `Connection failed: ${(error as Error).message}`,
      };
    }
  }

  // ─── List Resources ───────────────────────────────────

  async listResources(credentials: DecryptedCredentials, type: string): Promise<Resource[]> {
    switch (type) {
      case 'scenarios':
        return this.listScenarios(credentials);
      case 'connections':
        return this.listConnections(credentials);
      default:
        throw new Error(`Unknown Make resource type: ${type}`);
    }
  }

  private async listScenarios(credentials: DecryptedCredentials): Promise<Resource[]> {
    const data = await this.makeRequest<{
      scenarios: { id: number; name: string; islinked: boolean; scheduling: unknown }[];
    }>(credentials, 'GET', `/scenarios?pg[limit]=${LIST_LIMIT}`);

    return (data.scenarios ?? []).map((s) => ({
      id: String(s.id),
      type: 'scenario',
      name: s.name,
      metadata: {
        isActive: s.islinked,
        scheduling: s.scheduling,
      },
    }));
  }

  private async listConnections(credentials: DecryptedCredentials): Promise<Resource[]> {
    const data = await this.makeRequest<{
      connections: { id: number; name: string; accountName: string; accountType: string }[];
    }>(credentials, 'GET', `/connections?pg[limit]=${LIST_LIMIT}`);

    return (data.connections ?? []).map((c) => ({
      id: String(c.id),
      type: 'connection',
      name: c.name,
      metadata: {
        accountName: c.accountName,
        accountType: c.accountType,
      },
    }));
  }

  // ─── Get Resource ─────────────────────────────────────

  async getResource(credentials: DecryptedCredentials, type: string, id: string): Promise<Resource> {
    switch (type) {
      case 'scenario': {
        const data = await this.makeRequest<{
          scenario: { id: number; name: string; islinked: boolean; scheduling: unknown };
        }>(credentials, 'GET', `/scenarios/${id}`);
        return {
          id: String(data.scenario.id),
          type: 'scenario',
          name: data.scenario.name,
          metadata: { isActive: data.scenario.islinked },
        };
      }
      default:
        throw new Error(`Unknown Make resource type: ${type}`);
    }
  }

  // ─── Dry Run ──────────────────────────────────────────

  async dryRun(credentials: DecryptedCredentials, action: DeploymentAction): Promise<DryRunResult> {
    switch (action.type) {
      case 'create_scenario':
        return this.dryRunCreateScenario(credentials, action.params);
      case 'activate_scenario':
        return this.dryRunActivateScenario(credentials, action.params);
      case 'test_scenario':
        return this.dryRunTestScenario(credentials, action.params);
      default:
        return { valid: false, preview: '', warnings: [`Unknown action type: ${action.type}`] };
    }
  }

  private async dryRunCreateScenario(
    credentials: DecryptedCredentials,
    params: Record<string, unknown>,
  ): Promise<DryRunResult> {
    const nameValidation = MakeValidator.validateScenarioName(params.name as string);
    if (!nameValidation.valid) {
      return { valid: false, preview: '', warnings: nameValidation.errors };
    }

    // Check for duplicate names
    const scenarios = await this.listScenarios(credentials);
    const existing = scenarios.filter(
      (s) => s.name.toLowerCase() === nameValidation.sanitized.toLowerCase(),
    );

    if (existing.length > 0) {
      return {
        valid: false,
        preview: '',
        warnings: [`A scenario named "${nameValidation.sanitized}" already exists`],
        existingConflicts: existing,
      };
    }

    if (params.blueprint) {
      const bpValidation = MakeValidator.validateBlueprint(params.blueprint);
      if (!bpValidation.valid) {
        return { valid: false, preview: '', warnings: bpValidation.errors };
      }
    }

    return {
      valid: true,
      preview: `Create scenario "${nameValidation.sanitized}"${params.blueprint ? ' with blueprint' : ''}`,
      warnings: [],
    };
  }

  private async dryRunActivateScenario(
    credentials: DecryptedCredentials,
    params: Record<string, unknown>,
  ): Promise<DryRunResult> {
    const scenarioId = params.scenarioId as string;
    if (!scenarioId) {
      return { valid: false, preview: '', warnings: ['Scenario ID is required'] };
    }

    try {
      const scenario = await this.getResource(credentials, 'scenario', scenarioId);
      const isActive = (scenario.metadata as Record<string, unknown>)?.isActive;

      if (isActive) {
        return {
          valid: true,
          preview: `Scenario "${scenario.name}" is already active`,
          warnings: ['Scenario is already active — no changes needed'],
        };
      }

      return {
        valid: true,
        preview: `Activate scenario "${scenario.name}"`,
        warnings: [],
      };
    } catch {
      return { valid: false, preview: '', warnings: ['Scenario not found'] };
    }
  }

  private async dryRunTestScenario(
    credentials: DecryptedCredentials,
    params: Record<string, unknown>,
  ): Promise<DryRunResult> {
    const scenarioId = params.scenarioId as string;
    if (!scenarioId) {
      return { valid: false, preview: '', warnings: ['Scenario ID is required'] };
    }

    try {
      const scenario = await this.getResource(credentials, 'scenario', scenarioId);
      return {
        valid: true,
        preview: `Run scenario "${scenario.name}" once for testing`,
        warnings: ['This will execute the scenario with real data'],
      };
    } catch {
      return { valid: false, preview: '', warnings: ['Scenario not found'] };
    }
  }

  // ─── Execute ──────────────────────────────────────────

  async execute(credentials: DecryptedCredentials, action: DeploymentAction): Promise<ExecutionResult> {
    switch (action.type) {
      case 'create_scenario':
        return this.executeCreateScenario(credentials, action.params);
      case 'activate_scenario':
        return this.executeActivateScenario(credentials, action.params);
      case 'test_scenario':
        return this.executeTestScenario(credentials, action.params);
      default:
        throw new Error(`Unknown action type: ${action.type}`);
    }
  }

  private async executeCreateScenario(
    credentials: DecryptedCredentials,
    params: Record<string, unknown>,
  ): Promise<ExecutionResult> {
    const nameValidation = MakeValidator.validateScenarioName(params.name as string);
    if (!nameValidation.valid) throw new Error(nameValidation.errors.join(', '));

    const body: Record<string, unknown> = {
      name: nameValidation.sanitized,
    };

    if (params.blueprint) {
      body.blueprint = params.blueprint;
    }

    if (params.teamId) {
      body.teamId = params.teamId;
    }

    if (params.folderId) {
      body.folderId = params.folderId;
    }

    const data = await this.makeRequest<{
      scenario: { id: number; name: string };
    }>(credentials, 'POST', '/scenarios', body);

    this.logger.log(`Created Make scenario "${data.scenario.name}" (${data.scenario.id})`);

    return {
      success: true,
      resourceId: String(data.scenario.id),
      rollbackData: { action: 'create_scenario', scenarioId: data.scenario.id },
      metadata: { name: data.scenario.name },
    };
  }

  private async executeActivateScenario(
    credentials: DecryptedCredentials,
    params: Record<string, unknown>,
  ): Promise<ExecutionResult> {
    const scenarioId = params.scenarioId as string;

    // Get current state for rollback
    const scenario = await this.getResource(credentials, 'scenario', scenarioId);
    const wasActive = (scenario.metadata as Record<string, unknown>)?.isActive;

    await this.makeRequest(
      credentials,
      'PATCH',
      `/scenarios/${scenarioId}`,
      { scheduling: { type: 'immediately' } },
    );

    // Activate (link) the scenario
    await this.makeRequest(
      credentials,
      'POST',
      `/scenarios/${scenarioId}/start`,
    );

    this.logger.log(`Activated Make scenario ${scenarioId}`);

    return {
      success: true,
      resourceId: scenarioId,
      rollbackData: { action: 'activate_scenario', scenarioId, wasActive },
    };
  }

  private async executeTestScenario(
    credentials: DecryptedCredentials,
    params: Record<string, unknown>,
  ): Promise<ExecutionResult> {
    const scenarioId = params.scenarioId as string;

    const data = await this.makeRequest<{ execution: { id: number; status: string } }>(
      credentials,
      'POST',
      `/scenarios/${scenarioId}/run`,
    );

    this.logger.log(`Ran Make scenario ${scenarioId} — execution ${data.execution?.id}`);

    return {
      success: true,
      resourceId: scenarioId,
      rollbackData: { action: 'test_scenario' },
      metadata: { executionId: data.execution?.id, status: data.execution?.status },
    };
  }

  // ─── Rollback ─────────────────────────────────────────

  async rollback(
    credentials: DecryptedCredentials,
    _auditLogId: string,
    rollbackData: Record<string, unknown>,
  ): Promise<RollbackResult> {
    const action = rollbackData.action as string;

    switch (action) {
      case 'create_scenario': {
        const scenarioId = rollbackData.scenarioId as number;
        await this.makeRequest(credentials, 'DELETE', `/scenarios/${scenarioId}`);
        this.logger.log(`Rolled back: deleted Make scenario ${scenarioId}`);
        return { success: true, message: `Deleted scenario ${scenarioId}` };
      }

      case 'activate_scenario': {
        const scenarioId = rollbackData.scenarioId as string;
        const wasActive = rollbackData.wasActive as boolean;

        if (!wasActive) {
          await this.makeRequest(credentials, 'POST', `/scenarios/${scenarioId}/stop`);
          this.logger.log(`Rolled back: deactivated Make scenario ${scenarioId}`);
          return { success: true, message: `Deactivated scenario ${scenarioId}` };
        }

        return { success: true, message: 'Scenario was already active — no rollback needed' };
      }

      case 'test_scenario': {
        this.logger.warn('Cannot rollback a scenario test run');
        return { success: false, message: 'Test run cannot be undone' };
      }

      default:
        return { success: false, message: `Unknown rollback action: ${action}` };
    }
  }
}
