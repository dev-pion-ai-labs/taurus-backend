export interface ToolDryRunEnvelope {
  wouldExecute: true;
  summary: string;
  params: Record<string, unknown>;
}

export interface ToolErrorEnvelope {
  error: true;
  code: string;
  message: string;
}

export function toolError(code: string, message: string): ToolErrorEnvelope {
  return { error: true, code, message };
}

export function isToolError(value: unknown): value is ToolErrorEnvelope {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { error?: unknown }).error === true
  );
}
