import { CHANNEL_NAME_REGEX, MAX_MESSAGE_LENGTH } from './slack.constants';

export interface ChannelNameValidation {
  valid: boolean;
  sanitized: string;
  errors: string[];
}

export class SlackValidator {
  /**
   * Validate and sanitize a Slack channel name.
   * - Lowercases the input
   * - Replaces spaces with hyphens
   * - Strips invalid characters
   * - Returns validation result with sanitized name
   */
  static validateChannelName(name: string): ChannelNameValidation {
    const errors: string[] = [];

    if (!name || name.trim().length === 0) {
      return { valid: false, sanitized: '', errors: ['Channel name is required'] };
    }

    // Sanitize: lowercase, spaces → hyphens, strip invalid chars
    let sanitized = name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9_-]/g, '');

    // Ensure starts with alphanumeric
    sanitized = sanitized.replace(/^[^a-z0-9]+/, '');

    if (sanitized.length === 0) {
      return { valid: false, sanitized: '', errors: ['Channel name contains no valid characters'] };
    }

    if (sanitized.length > 80) {
      sanitized = sanitized.slice(0, 80);
      errors.push('Channel name truncated to 80 characters');
    }

    const valid = CHANNEL_NAME_REGEX.test(sanitized);
    if (!valid) {
      errors.push(
        'Channel name must start with a letter or digit and contain only lowercase letters, digits, hyphens, or underscores',
      );
    }

    return { valid: errors.length === 0 || (errors.length === 1 && errors[0].includes('truncated')), sanitized, errors };
  }

  /**
   * Sanitize a message for Slack posting.
   * - Strips control characters (except newlines/tabs)
   * - Truncates to 4000 chars (Slack API limit)
   */
  static sanitizeMessage(text: string): string {
    if (!text) return '';

    // Strip control chars except \n and \t
    // eslint-disable-next-line no-control-regex
    let sanitized = text.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');

    if (sanitized.length > MAX_MESSAGE_LENGTH) {
      sanitized = sanitized.slice(0, MAX_MESSAGE_LENGTH - 3) + '...';
    }

    return sanitized;
  }
}
