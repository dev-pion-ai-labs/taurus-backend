export class NotionValidator {
  static validatePageTitle(title: string): { valid: boolean; sanitized: string; errors: string[] } {
    if (!title || title.trim().length === 0) {
      return { valid: false, sanitized: '', errors: ['Page title is required'] };
    }

    let sanitized = title.trim();
    if (sanitized.length > 256) {
      sanitized = sanitized.slice(0, 256);
    }

    return { valid: true, sanitized, errors: [] };
  }

  static validateDatabaseId(id: string): { valid: boolean; errors: string[] } {
    if (!id || id.trim().length === 0) {
      return { valid: false, errors: ['Database ID is required'] };
    }
    // Notion IDs are 32-char hex (with or without hyphens)
    const cleaned = id.replace(/-/g, '');
    if (!/^[a-f0-9]{32}$/i.test(cleaned)) {
      return { valid: false, errors: ['Invalid Notion database ID format'] };
    }
    return { valid: true, errors: [] };
  }
}
