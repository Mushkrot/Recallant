import process from "node:process";

type StdioShutdownReason = "stdin_end" | "stdin_error" | "signal";

/**
 * Keep a stdio MCP server alive while its client is connected, and finish the
 * server cleanly when the client closes stdin or the process receives a signal.
 *
 * MCP clients normally own the child process. Waiting only for SIGTERM leaves
 * the child orphaned when the client closes its pipes without sending a signal.
 */
export function waitForStdioShutdown(
  input: NodeJS.ReadableStream = process.stdin
): Promise<StdioShutdownReason> {
  input.resume();

  return new Promise((resolve) => {
    let settled = false;

    const finish = (reason: StdioShutdownReason) => {
      if (settled) return;
      settled = true;
      input.off("end", onEnd);
      input.off("error", onError);
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
      resolve(reason);
    };

    const onEnd = () => finish("stdin_end");
    const onError = () => finish("stdin_error");
    const onSignal = () => finish("signal");

    input.once("end", onEnd);
    input.once("error", onError);
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
  });
}
