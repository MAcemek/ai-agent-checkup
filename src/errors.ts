/** Invalid arguments, inputs or paths. Exit code 2. */
export class UsageError extends Error {
  override name = 'UsageError';
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
