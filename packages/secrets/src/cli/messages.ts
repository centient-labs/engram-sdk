/**
 * Auth Module - Centralized Message Strings
 *
 * All user-visible strings for the auth module are defined here.
 * This module is i18n-ready: message values do not contain interpolated
 * strings — template functions accept parameters and return formatted strings.
 *
 * Usage:
 *   import { AUTH_MESSAGES } from './messages.js';
 *   process.stderr.write(AUTH_MESSAGES.error.vaultWriteFailed + '\n');
 *   process.stderr.write(AUTH_MESSAGES.info.loginPrompt('https://auth.example.com') + '\n');
 */

// =============================================================================
// Message catalog
// =============================================================================

export const AUTH_MESSAGES = {
  success: {
    loggedIn: "Authentication successful. You are now logged in.",
    loggedOut: "Logged out successfully. Credentials removed.",
    tokenStored: "Token stored securely in vault.",
    tokenRefreshed: "Token refreshed successfully.",
    apiKeyStored: "API key stored securely in vault.",
    revokeComplete: "Token revoked on server.",
  },

  error: {
    vaultWriteFailed: "Failed to write credentials to vault.",
    vaultReadFailed: "Failed to read credentials from vault.",
    vaultDeleteFailed: "Failed to delete credentials from vault.",
    deviceFlowFailed: "Device authorization flow failed.",
    deviceFlowTimeout: "Device authorization timed out. Please try again.",
    deviceFlowAccessDenied: "Access denied. Authorization was rejected.",
    deviceFlowExpired: "Device code expired. Please run login again.",
    tokenExpired: "Your session has expired. Please run `centient login`.",
    tokenInvalid: "Invalid token format.",
    tokenMalformed: "Could not decode token — unexpected format.",
    networkError: "Network error during authentication.",
    refreshFailed: "Token refresh failed. Please run `centient login` again.",
    revokeFailed: "Token revocation failed (server may be unreachable).",
    apiKeyInvalidFormat: (key: string): string =>
      `Invalid API key format: '${key}'. API keys must start with 'eng_'.`,
    agentEnvironmentBlocked:
      "This command is not available in agent environments.",
    unknownSubcommand: (cmd: string): string =>
      `Unknown subcommand: '${cmd}'. Run \`centient auth --help\` for usage.`,
  },

  warning: {
    tokenExpiringSoon: (minutes: number): string =>
      `Your token expires in ${minutes} minute${minutes === 1 ? "" : "s"}. Run \`centient login\` to refresh.`,
    revokeNetworkFailure:
      "Could not reach server to revoke token — local credentials have been removed.",
    noCredentialsFound:
      "No stored credentials found. Run `centient login` to authenticate.",
    sessionExpiredIdle: "Session expired due to inactivity.",
    envVaultNoStorage:
      "No secure credential storage available. Install libsecret (Linux: apt install libsecret-tools) or GPG for persistent storage. Using ENGRAM_API_KEY environment variable only.",
  },

  info: {
    loginPrompt: (verificationUri: string): string =>
      `Visit the following URL to authorize this device:\n  ${verificationUri}`,
    userCodeDisplay: (userCode: string): string =>
      `Enter this code when prompted:\n  ${userCode}`,
    pollingWait: (seconds: number): string =>
      `Waiting for authorization... (${seconds}s remaining)`,
    loginRecoveryHint:
      "If login fails, set ENGRAM_API_KEY in your environment for headless/CI usage.",
    authStatusAuthenticated: (expiresIn: string): string =>
      `Authenticated. Token expires in ${expiresIn}.`,
    authStatusUnauthenticated: "Not authenticated. Run `centient login`.",
    authStatusExpiringSoon: (minutes: number): string =>
      `Authenticated (expiring in ${minutes} minute${minutes === 1 ? "" : "s"}).`,
    vaultType: (vaultType: string): string => `Vault: ${vaultType}`,
    logoutStarting: "Logging out...",
    loginStarting: "Starting device authorization flow...",
  },
} as const;
