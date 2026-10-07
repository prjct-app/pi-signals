import { createLocalBashOperations } from '@earendil-works/pi-coding-agent';

export type Check = { command: string; code: number; output: string; durationMs: number };
export const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
/** Use Pi's public execution/cancellation backend, including process-tree cleanup. */
export async function command(cwd: string, value: string | string[], signal?: AbortSignal): Promise<Check> {
  const text = Array.isArray(value) ? value.map(quote).join(' ') : value;
  const chunks: Buffer[] = [], start = performance.now();
  const result = await createLocalBashOperations().exec(text, cwd, { onData: data => chunks.push(data), signal, timeout: 600 });
  return { command: text, code: result.exitCode ?? 128, output: Buffer.concat(chunks).toString('utf8'), durationMs: performance.now() - start };
}
export async function must(cwd: string, value: string | string[], signal?: AbortSignal) {
  const result = await command(cwd, value, signal);
  if (result.code !== 0) throw new Error(`Command failed (${result.code}): ${result.command}\n${result.output}`);
  return result.output.trim();
}
