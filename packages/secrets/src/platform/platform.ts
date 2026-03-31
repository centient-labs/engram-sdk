/**
 * Auth Platform — Capability Detection
 *
 * Detects terminal/platform capabilities for rendering decisions.
 * All functions are pure (no side effects beyond reading process.env / process.stdout).
 */

import { existsSync, readFileSync } from "fs";
import { execSync } from "child_process";

// =============================================================================
// TTY detection
// =============================================================================

/**
 * Returns true if stdout is a TTY (interactive terminal).
 * Spinner, colour, and unicode output should only be used when this is true.
 */
export function isTTY(): boolean {
  return process.stdout.isTTY === true;
}

// =============================================================================
// Unicode detection
// =============================================================================

/**
 * Returns true if the terminal likely supports Unicode characters.
 * Detection is based on LANG or LC_ALL containing "UTF-8" (case-insensitive).
 * Falls back to false when environment variables are absent.
 */
export function canUnicode(): boolean {
  const lang = process.env["LANG"] ?? "";
  const lcAll = process.env["LC_ALL"] ?? "";
  const lcCtype = process.env["LC_CTYPE"] ?? "";
  return (
    /utf-?8/i.test(lang) ||
    /utf-?8/i.test(lcAll) ||
    /utf-?8/i.test(lcCtype)
  );
}

// =============================================================================
// Headless detection
// =============================================================================

/**
 * Returns true if running in a headless environment (no display server).
 *
 * On Linux: checks for absence of DISPLAY and WAYLAND_DISPLAY and
 * XDG_CURRENT_DESKTOP env vars.
 * On macOS: always returns false (macOS always has a window server available
 * even in SSH sessions with X11 forwarding disabled).
 * In CI environments: treats CI=true as headless.
 */
export function isHeadless(): boolean {
  // Explicit CI flag
  if (process.env["CI"] === "true" || process.env["CI"] === "1") return true;

  // macOS has a window server; treat as non-headless unless CI
  if (process.platform === "darwin") return false;

  // Linux: headless if no display server variables are set
  if (process.platform === "linux") {
    const hasDisplay = Boolean(process.env["DISPLAY"]);
    const hasWayland = Boolean(process.env["WAYLAND_DISPLAY"]);
    const hasDesktop = Boolean(process.env["XDG_CURRENT_DESKTOP"]);
    return !hasDisplay && !hasWayland && !hasDesktop;
  }

  // Unknown platform — assume headless for safety
  return true;
}

// =============================================================================
// Browser launch detection
// =============================================================================

/**
 * Returns true if the system has a browser launcher available.
 *
 * macOS: checks for `open` (always present).
 * Linux: checks for `xdg-open` via `which`.
 * Other: returns false.
 */
export function canLaunchBrowser(): boolean {
  if (isHeadless()) return false;

  try {
    if (process.platform === "darwin") {
      execSync("which open", { stdio: "pipe" });
      return true;
    }

    if (process.platform === "linux") {
      execSync("which xdg-open", { stdio: "pipe" });
      return true;
    }
  } catch {
    // `which` returned non-zero — tool not found
  }

  return false;
}

// =============================================================================
// CI environment detection
// =============================================================================

/**
 * Returns true if the process is running in a known CI environment.
 * Checks standard CI environment variables used by common CI platforms.
 */
export function isCIEnvironment(): boolean {
  return !!(
    process.env["CI"] ||
    process.env["GITHUB_ACTIONS"] ||
    process.env["GITLAB_CI"] ||
    process.env["CIRCLECI"] ||
    process.env["TRAVIS"] ||
    process.env["BUILDKITE"]
  );
}

// =============================================================================
// Docker/container detection
// =============================================================================

/**
 * Returns true if the process is running inside a Docker or containerd container.
 * Checks /proc/1/cgroup for container markers and /.dockerenv existence.
 */
export function isDockerContainer(): boolean {
  // Check for /.dockerenv (Docker-specific file)
  if (existsSync("/.dockerenv")) return true;

  // Check /proc/1/cgroup for docker or containerd markers (Linux only)
  if (process.platform === "linux") {
    try {
      const cgroup = readFileSync("/proc/1/cgroup", "utf8");
      if (/docker|containerd/.test(cgroup)) return true;
    } catch {
      // /proc/1/cgroup not readable — not a concern on non-Linux
    }
  }

  return false;
}

// =============================================================================
// SSH session detection
// =============================================================================

/**
 * Returns true if the process is running inside an SSH session.
 * Checks SSH_CONNECTION and SSH_CLIENT environment variables.
 */
export function isSSHSession(): boolean {
  return !!(process.env["SSH_CONNECTION"] || process.env["SSH_CLIENT"]);
}
