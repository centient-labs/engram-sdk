/**
 * Environment Manager
 *
 * Manages multi-environment support for the secrets management system.
 * Provides isolated configuration and vault storage per environment.
 *
 * Directory structure:
 *   ~/.centient/environments/
 *     ├── dev/
 *     │   ├── config.json
 *     │   └── vault.enc
 *     ├── staging/
 *     │   ├── config.json
 *     │   └── vault.enc
 *     └── prod/
 *         ├── config.json
 *         └── vault.enc
 *   ~/.centient/current -> environments/dev/  (symlink)
 *
 * Security:
 *   - All operations that modify environments check for AI agent context
 *   - Agents can read/list environments but cannot switch or create
 *   - This prevents accidental environment changes during AI sessions
 */

import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  lstatSync,
  symlinkSync,
  unlinkSync,
  readlinkSync,
  rmSync,
} from "fs";
import { join, basename, relative } from "path";
import { homedir } from "os";

// =============================================================================
// Types
// =============================================================================

export interface Environment {
  /** Environment name (e.g., "dev", "staging", "prod") */
  name: string;
  /** Absolute path to environment directory */
  path: string;
  /** Whether this is the currently active environment */
  isActive: boolean;
  /** Whether the environment has a config.json */
  hasConfig: boolean;
  /** Whether the environment has a vault.enc */
  hasVault: boolean;
  /** Last modified timestamp of the environment directory */
  lastModified?: Date;
}

export interface EnvironmentResult {
  success: boolean;
  message: string;
  environment?: Environment;
  nextAction?: string;
}

export interface ListEnvironmentsResult {
  success: boolean;
  environments: Environment[];
  currentEnvironment: string | null;
  message?: string;
}

export interface EnvironmentConfig {
  /** Optional description of this environment */
  description?: string;
  /** When this environment was created */
  createdAt: string;
  /** Who created this environment */
  createdBy?: string;
}

// =============================================================================
// Constants
// =============================================================================

const CENTIENT_DIR = join(homedir(), ".centient");
const ENVIRONMENTS_DIR = join(CENTIENT_DIR, "environments");
const CURRENT_LINK = join(CENTIENT_DIR, "current");
const DEFAULT_ENVIRONMENT = "dev";
const RESERVED_NAMES = ["current", "environments", "config", "logs", "cache"];

// =============================================================================
// Agent Detection
// =============================================================================

/**
 * Check if running in an AI agent environment.
 *
 * Detects Claude Code and similar AI agent contexts by checking for
 * environment variables that indicate an agent session.
 */
function isAgentEnvironment(): boolean {
  return !!(
    process.env.CLAUDE_PROJECT_DIR ||
    process.env.MCP_CONTEXT ||
    process.env.CLAUDE_CODE_SESSION ||
    process.env.CLAUDE_CODE_ENTRY_POINT
  );
}

// =============================================================================
// Path Utilities
// =============================================================================

/**
 * Get the path to an environment directory
 */
function getEnvironmentPath(name: string): string {
  return join(ENVIRONMENTS_DIR, name);
}

/**
 * Get the path to an environment's config.json
 */
function getEnvironmentConfigPath(name: string): string {
  return join(getEnvironmentPath(name), "config.json");
}

/**
 * Get the path to an environment's vault.enc
 */
function getEnvironmentVaultPath(name: string): string {
  return join(getEnvironmentPath(name), "vault.enc");
}

// =============================================================================
// Validation
// =============================================================================

/**
 * Validate environment name
 *
 * Rules:
 * - 1-32 characters
 * - Alphanumeric, hyphens, underscores only
 * - Cannot be a reserved name
 * - Cannot start with a hyphen or underscore
 */
function validateEnvironmentName(name: string): {
  valid: boolean;
  error?: string;
} {
  if (!name || name.length === 0) {
    return { valid: false, error: "Environment name is required" };
  }

  if (name.length > 32) {
    return {
      valid: false,
      error: "Environment name must be 32 characters or less",
    };
  }

  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(name)) {
    return {
      valid: false,
      error:
        "Environment name must start with alphanumeric and contain only alphanumeric, hyphens, and underscores",
    };
  }

  if (RESERVED_NAMES.includes(name.toLowerCase())) {
    return {
      valid: false,
      error: `"${name}" is a reserved name and cannot be used as an environment name`,
    };
  }

  return { valid: true };
}

// =============================================================================
// Environment Manager Class
// =============================================================================

export class EnvironmentManager {
  /**
   * List all available environments
   *
   * Returns information about each environment including:
   * - Name
   * - Path
   * - Whether it's currently active
   * - Whether it has config and vault files
   */
  listEnvironments(): ListEnvironmentsResult {
    // Ensure environments directory exists
    if (!existsSync(ENVIRONMENTS_DIR)) {
      return {
        success: true,
        environments: [],
        currentEnvironment: null,
        message:
          "No environments configured. Run 'centient env create dev' to create your first environment.",
      };
    }

    const currentEnv = this.getCurrentEnvironment();
    const environments: Environment[] = [];

    try {
      const entries = readdirSync(ENVIRONMENTS_DIR, { withFileTypes: true });

      for (const entry of entries) {
        if (entry.isDirectory()) {
          const envPath = getEnvironmentPath(entry.name);
          const configPath = getEnvironmentConfigPath(entry.name);
          const vaultPath = getEnvironmentVaultPath(entry.name);

          let lastModified: Date | undefined;
          try {
            const stats = lstatSync(envPath);
            lastModified = stats.mtime;
          } catch {
            // Ignore stat errors
          }

          environments.push({
            name: entry.name,
            path: envPath,
            isActive: entry.name === currentEnv,
            hasConfig: existsSync(configPath),
            hasVault: existsSync(vaultPath),
            lastModified,
          });
        }
      }

      // Sort by name, but put active environment first
      environments.sort((a, b) => {
        if (a.isActive) return -1;
        if (b.isActive) return 1;
        return a.name.localeCompare(b.name);
      });

      return {
        success: true,
        environments,
        currentEnvironment: currentEnv,
      };
    } catch (error) {
      return {
        success: false,
        environments: [],
        currentEnvironment: null,
        message: `Failed to list environments: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Get the currently active environment name
   *
   * Returns the name of the environment that the 'current' symlink points to,
   * or null if no environment is set.
   */
  getCurrentEnvironment(): string | null {
    if (!existsSync(CURRENT_LINK)) {
      return null;
    }

    try {
      const stats = lstatSync(CURRENT_LINK);
      if (!stats.isSymbolicLink()) {
        return null;
      }

      const target = readlinkSync(CURRENT_LINK);
      // Handle both absolute and relative symlink targets
      const envName = target.includes("environments/")
        ? basename(target)
        : basename(target);

      // Verify the target environment exists
      if (existsSync(getEnvironmentPath(envName))) {
        return envName;
      }

      return null;
    } catch {
      return null;
    }
  }

  /**
   * Get details about a specific environment
   */
  getEnvironment(name: string): Environment | null {
    const validation = validateEnvironmentName(name);
    if (!validation.valid) {
      return null;
    }

    const envPath = getEnvironmentPath(name);
    if (!existsSync(envPath)) {
      return null;
    }

    const configPath = getEnvironmentConfigPath(name);
    const vaultPath = getEnvironmentVaultPath(name);
    const currentEnv = this.getCurrentEnvironment();

    let lastModified: Date | undefined;
    try {
      const stats = lstatSync(envPath);
      lastModified = stats.mtime;
    } catch {
      // Ignore stat errors
    }

    return {
      name,
      path: envPath,
      isActive: name === currentEnv,
      hasConfig: existsSync(configPath),
      hasVault: existsSync(vaultPath),
      lastModified,
    };
  }

  /**
   * Switch to a different environment
   *
   * Updates the 'current' symlink to point to the specified environment.
   * This operation is blocked for AI agents to prevent accidental
   * environment changes during automated sessions.
   *
   * @param name - Name of the environment to switch to
   */
  switchEnvironment(name: string): EnvironmentResult {
    // Block agent access
    if (isAgentEnvironment()) {
      return {
        success: false,
        message:
          "Environment switching is not available to AI agents. " +
          "This is a security measure to prevent accidental environment changes during automated sessions.",
        nextAction:
          "Have a human run 'centient env switch <name>' from a terminal",
      };
    }

    // Validate name
    const validation = validateEnvironmentName(name);
    if (!validation.valid) {
      return {
        success: false,
        message: validation.error || "Invalid environment name",
      };
    }

    // Check if environment exists
    const envPath = getEnvironmentPath(name);
    if (!existsSync(envPath)) {
      return {
        success: false,
        message: `Environment "${name}" does not exist`,
        nextAction: `Create it with 'centient env create ${name}'`,
      };
    }

    // Check if already active
    const currentEnv = this.getCurrentEnvironment();
    if (currentEnv === name) {
      return {
        success: true,
        message: `Already using environment "${name}"`,
        environment: this.getEnvironment(name) || undefined,
      };
    }

    try {
      // Remove existing symlink if it exists
      if (existsSync(CURRENT_LINK)) {
        unlinkSync(CURRENT_LINK);
      }

      // Create relative symlink (more portable)
      const relativeTarget = relative(CENTIENT_DIR, envPath);
      symlinkSync(relativeTarget, CURRENT_LINK);

      const env = this.getEnvironment(name);

      return {
        success: true,
        message: `Switched to environment "${name}"`,
        environment: env || undefined,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to switch environment: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Create a new environment
   *
   * Creates the environment directory with initial config.json.
   * Optionally sets it as the current environment.
   * This operation is blocked for AI agents.
   *
   * @param name - Name for the new environment
   * @param options - Creation options
   */
  createEnvironment(
    name: string,
    options?: {
      /** Set as current environment after creation */
      setAsCurrent?: boolean;
      /** Optional description for the environment */
      description?: string;
      /** Copy config from another environment */
      copyFrom?: string;
    },
  ): EnvironmentResult {
    // Block agent access
    if (isAgentEnvironment()) {
      return {
        success: false,
        message:
          "Environment creation is not available to AI agents. " +
          "This is a security measure to prevent automated environment modifications.",
        nextAction:
          "Have a human run 'centient env create <name>' from a terminal",
      };
    }

    // Validate name
    const validation = validateEnvironmentName(name);
    if (!validation.valid) {
      return {
        success: false,
        message: validation.error || "Invalid environment name",
      };
    }

    // Check if environment already exists
    const envPath = getEnvironmentPath(name);
    if (existsSync(envPath)) {
      return {
        success: false,
        message: `Environment "${name}" already exists`,
        environment: this.getEnvironment(name) || undefined,
      };
    }

    // Check if copying from another environment
    let baseConfig: Record<string, unknown> = {};
    if (options?.copyFrom) {
      const sourceConfigPath = getEnvironmentConfigPath(options.copyFrom);
      if (!existsSync(sourceConfigPath)) {
        return {
          success: false,
          message: `Source environment "${options.copyFrom}" does not have a config to copy`,
        };
      }
      try {
        baseConfig = JSON.parse(readFileSync(sourceConfigPath, "utf-8"));
      } catch (error) {
        return {
          success: false,
          message: `Failed to read config from "${options.copyFrom}": ${error instanceof Error ? error.message : String(error)}`,
        };
      }
    }

    try {
      // Ensure environments directory exists
      mkdirSync(ENVIRONMENTS_DIR, { recursive: true });

      // Create environment directory
      mkdirSync(envPath, { recursive: true });

      // Create initial config
      const envConfig: EnvironmentConfig = {
        description: options?.description || `${name} environment`,
        createdAt: new Date().toISOString(),
        createdBy: process.env.USER || process.env.USERNAME || "unknown",
      };

      const fullConfig = {
        ...baseConfig,
        _environment: envConfig,
      };

      writeFileSync(
        getEnvironmentConfigPath(name),
        JSON.stringify(fullConfig, null, 2),
        "utf-8",
      );

      // Set as current if requested or if it's the first environment
      const shouldSetCurrent =
        options?.setAsCurrent ||
        (!existsSync(CURRENT_LINK) && name === DEFAULT_ENVIRONMENT);

      if (shouldSetCurrent) {
        const switchResult = this.switchEnvironment(name);
        if (!switchResult.success) {
          // Environment created but switch failed - still report success with warning
          return {
            success: true,
            message: `Environment "${name}" created but failed to set as current: ${switchResult.message}`,
            environment: this.getEnvironment(name) || undefined,
          };
        }
      }

      return {
        success: true,
        message: shouldSetCurrent
          ? `Environment "${name}" created and set as current`
          : `Environment "${name}" created`,
        environment: this.getEnvironment(name) || undefined,
        nextAction: shouldSetCurrent
          ? undefined
          : `Switch to it with 'centient env switch ${name}'`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to create environment: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Delete an environment
   *
   * Removes the environment directory and all its contents.
   * Cannot delete the currently active environment.
   * This operation is blocked for AI agents.
   *
   * @param name - Name of the environment to delete
   * @param options - Deletion options
   */
  deleteEnvironment(
    name: string,
    options?: {
      /** Force deletion even if environment has vault.enc */
      force?: boolean;
    },
  ): EnvironmentResult {
    // Block agent access
    if (isAgentEnvironment()) {
      return {
        success: false,
        message:
          "Environment deletion is not available to AI agents. " +
          "This is a security measure to prevent accidental data loss.",
        nextAction:
          "Have a human run 'centient env delete <name>' from a terminal",
      };
    }

    // Validate name
    const validation = validateEnvironmentName(name);
    if (!validation.valid) {
      return {
        success: false,
        message: validation.error || "Invalid environment name",
      };
    }

    // Check if environment exists
    const envPath = getEnvironmentPath(name);
    if (!existsSync(envPath)) {
      return {
        success: false,
        message: `Environment "${name}" does not exist`,
      };
    }

    // Cannot delete current environment
    const currentEnv = this.getCurrentEnvironment();
    if (currentEnv === name) {
      return {
        success: false,
        message: `Cannot delete the current environment "${name}"`,
        nextAction: `Switch to another environment first with 'centient env switch <other>'`,
      };
    }

    // Check for vault.enc if not forcing
    const vaultPath = getEnvironmentVaultPath(name);
    if (existsSync(vaultPath) && !options?.force) {
      return {
        success: false,
        message: `Environment "${name}" has encrypted secrets. Use --force to delete anyway.`,
        nextAction: `Run 'centient env delete ${name} --force' to confirm deletion`,
      };
    }

    try {
      // Remove directory recursively
      rmSync(envPath, { recursive: true, force: true });

      return {
        success: true,
        message: `Environment "${name}" deleted`,
      };
    } catch (error) {
      return {
        success: false,
        message: `Failed to delete environment: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }

  /**
   * Initialize the environment system
   *
   * Creates the default 'dev' environment if no environments exist.
   * Sets up the 'current' symlink to point to 'dev'.
   * This operation is blocked for AI agents.
   */
  initialize(): EnvironmentResult {
    // Block agent access for initialization
    if (isAgentEnvironment()) {
      return {
        success: false,
        message:
          "Environment initialization is not available to AI agents. " +
          "This is a security measure to prevent automated environment setup.",
        nextAction: "Have a human run 'centient env init' from a terminal",
      };
    }

    // Check if already initialized
    const listResult = this.listEnvironments();
    if (listResult.environments.length > 0) {
      return {
        success: true,
        message: `Environment system already initialized with ${listResult.environments.length} environment(s)`,
        environment:
          listResult.environments.find((e) => e.isActive) || undefined,
      };
    }

    // Create default environment
    const createResult = this.createEnvironment(DEFAULT_ENVIRONMENT, {
      setAsCurrent: true,
      description: "Default development environment",
    });

    if (!createResult.success) {
      return createResult;
    }

    return {
      success: true,
      message: `Environment system initialized with default "${DEFAULT_ENVIRONMENT}" environment`,
      environment: createResult.environment,
    };
  }

  /**
   * Get the path to the current environment's directory
   *
   * Returns the resolved path that the 'current' symlink points to,
   * or null if no current environment is set.
   */
  getCurrentEnvironmentPath(): string | null {
    const currentEnv = this.getCurrentEnvironment();
    if (!currentEnv) {
      return null;
    }
    return getEnvironmentPath(currentEnv);
  }

  /**
   * Get the path to the current environment's config.json
   */
  getCurrentConfigPath(): string | null {
    const currentEnv = this.getCurrentEnvironment();
    if (!currentEnv) {
      return null;
    }
    return getEnvironmentConfigPath(currentEnv);
  }

  /**
   * Get the path to the current environment's vault.enc
   */
  getCurrentVaultPath(): string | null {
    const currentEnv = this.getCurrentEnvironment();
    if (!currentEnv) {
      return null;
    }
    return getEnvironmentVaultPath(currentEnv);
  }

  /**
   * Check if the environment system is initialized
   */
  isInitialized(): boolean {
    return existsSync(ENVIRONMENTS_DIR) && existsSync(CURRENT_LINK);
  }
}

// =============================================================================
// Singleton Instance
// =============================================================================

let defaultManager: EnvironmentManager | null = null;

/**
 * Get the singleton EnvironmentManager instance
 */
export function getEnvironmentManager(): EnvironmentManager {
  if (!defaultManager) {
    defaultManager = new EnvironmentManager();
  }
  return defaultManager;
}

/**
 * Reset the singleton instance (for testing)
 */
export function resetEnvironmentManager(): void {
  defaultManager = null;
}

// =============================================================================
// Convenience Exports
// =============================================================================

/**
 * Get the environments directory path
 */
export function getEnvironmentsDir(): string {
  return ENVIRONMENTS_DIR;
}

/**
 * Get the current symlink path
 */
export function getCurrentLinkPath(): string {
  return CURRENT_LINK;
}

/**
 * Get the default environment name
 */
export function getDefaultEnvironmentName(): string {
  return DEFAULT_ENVIRONMENT;
}
