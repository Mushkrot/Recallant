export async function optionalProjectLogMirror<T>(input: {
  projectLogPath: string;
  write: () => Promise<T>;
}) {
  try {
    return await input.write();
  } catch (error) {
    return {
      status: "skipped" as const,
      reason: "project_log_sync_write_failed" as const,
      project_log_sync: null,
      path: input.projectLogPath,
      warning: error instanceof Error ? error.message : String(error)
    };
  }
}
