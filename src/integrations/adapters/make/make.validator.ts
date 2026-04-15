export class MakeValidator {
  /**
   * Validate a scenario name.
   */
  static validateScenarioName(name: string): { valid: boolean; sanitized: string; errors: string[] } {
    const errors: string[] = [];

    if (!name || name.trim().length === 0) {
      return { valid: false, sanitized: '', errors: ['Scenario name is required'] };
    }

    let sanitized = name.trim();

    if (sanitized.length > 255) {
      sanitized = sanitized.slice(0, 255);
      errors.push('Scenario name truncated to 255 characters');
    }

    return { valid: true, sanitized, errors };
  }

  /**
   * Validate a Make.com blueprint (scenario definition JSON).
   * Checks for required top-level structure.
   */
  static validateBlueprint(blueprint: unknown): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    if (!blueprint || typeof blueprint !== 'object') {
      return { valid: false, errors: ['Blueprint must be a valid JSON object'] };
    }

    const bp = blueprint as Record<string, unknown>;

    if (!bp.name) {
      errors.push('Blueprint must have a "name" field');
    }

    return { valid: errors.length === 0, errors };
  }
}
