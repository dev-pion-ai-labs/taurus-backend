import { WORKFLOW_FILENAME_REGEX } from './github.constants';

export interface WorkflowFilenameValidation {
  valid: boolean;
  sanitized: string;
  errors: string[];
}

export class GitHubValidator {
  /**
   * Validate and sanitize a workflow filename.
   * - Ensures it ends with .yml or .yaml
   * - Strips invalid characters
   * - Returns validation result
   */
  static validateWorkflowFilename(name: string): WorkflowFilenameValidation {
    const errors: string[] = [];

    if (!name || name.trim().length === 0) {
      return { valid: false, sanitized: '', errors: ['Workflow filename is required'] };
    }

    let sanitized = name.trim();

    // Add .yml extension if missing
    if (!sanitized.endsWith('.yml') && !sanitized.endsWith('.yaml')) {
      sanitized += '.yml';
    }

    // Strip invalid characters (keep alphanumeric, hyphens, underscores, dots)
    const ext = sanitized.endsWith('.yaml') ? '.yaml' : '.yml';
    const baseName = sanitized.slice(0, -ext.length);
    const cleanBase = baseName.replace(/[^a-zA-Z0-9_-]/g, '-').replace(/^[^a-zA-Z0-9]+/, '');
    sanitized = cleanBase + ext;

    if (cleanBase.length === 0) {
      return { valid: false, sanitized: '', errors: ['Workflow filename contains no valid characters'] };
    }

    if (sanitized.length > 100) {
      return { valid: false, sanitized: '', errors: ['Workflow filename exceeds 100 characters'] };
    }

    const valid = WORKFLOW_FILENAME_REGEX.test(sanitized);
    if (!valid) {
      errors.push('Workflow filename must start with alphanumeric and contain only letters, digits, hyphens, or underscores');
    }

    return { valid: errors.length === 0, sanitized, errors };
  }

  /**
   * Basic YAML content validation for GitHub Actions workflow.
   * Checks for required top-level keys.
   */
  static validateWorkflowYaml(content: string): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!content || content.trim().length === 0) {
      return { valid: false, errors: ['Workflow content is required'] };
    }

    // Check for required top-level keys (basic text check, not full YAML parse)
    if (!content.includes('on:') && !content.includes('on :')) {
      errors.push('Workflow YAML must contain an "on:" trigger section');
    }

    if (!content.includes('jobs:') && !content.includes('jobs :')) {
      errors.push('Workflow YAML must contain a "jobs:" section');
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * Validate a repo name format (owner/repo).
   */
  static validateRepoFullName(name: string): { valid: boolean; owner: string; repo: string; errors: string[] } {
    if (!name || !name.includes('/')) {
      return { valid: false, owner: '', repo: '', errors: ['Repository must be in "owner/repo" format'] };
    }

    const [owner, repo, ...rest] = name.split('/');

    if (rest.length > 0 || !owner || !repo) {
      return { valid: false, owner: '', repo: '', errors: ['Repository must be in "owner/repo" format'] };
    }

    return { valid: true, owner, repo, errors: [] };
  }
}
