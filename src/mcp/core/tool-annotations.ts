export type ToolSensitivity = 'read' | 'write' | 'destructive';

export function shouldDryRun(
  sensitivity: ToolSensitivity,
  executionMode: 'planning' | 'approved-execution',
  hasDryRunHandler: boolean,
): boolean {
  if (executionMode === 'approved-execution') return false;
  if (sensitivity === 'read') return false;
  if (sensitivity === 'destructive') return true;
  // write: prefer dry-run if a handler exists, otherwise execute
  return hasDryRunHandler;
}
