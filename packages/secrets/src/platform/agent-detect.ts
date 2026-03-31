/**
 * Agent Environment Detection
 *
 * Detects whether the process is running inside an AI agent session
 * (Claude Code, MCP context, etc.). Auth commands that require human
 * interaction are blocked in these environments.
 *
 * Shared by: vault.ts, cli, secrets-cli.ts
 */

/**
 * Returns true if the current process appears to be running inside an
 * AI agent environment (Claude Code, MCP subprocess, etc.).
 */
export function isAgentEnvironment(): boolean {
  return !!(
    process.env["CLAUDE_PROJECT_DIR"] ||
    process.env["MCP_CONTEXT"] ||
    process.env["CLAUDE_CODE_SESSION"] ||
    process.env["CLAUDE_CODE_ENTRY_POINT"] ||
    process.env["ANTHROPIC_API_KEY_SOURCE"] ||
    process.env["MCP_SERVER_NAME"]
  );
}
