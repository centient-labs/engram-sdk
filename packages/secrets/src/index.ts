// Encryption
export { encrypt, decrypt, encryptObject, decryptObject } from "./crypto/vault-common.js";
export { ALGORITHM, IV_LENGTH, AUTH_TAG_LENGTH, KEY_LENGTH } from "./crypto/vault-common.js";

// Credential vault
export { storeCredential, getCredential, deleteCredential, getActiveVaultType, isSessionValid } from "./vault/vault.js";
export type { VaultBackend, VaultType, StoredCredentialMeta } from "./vault/types.js";

// Platform detection
export { isTTY, canUnicode, isHeadless, canLaunchBrowser, isCIEnvironment, isDockerContainer, isSSHSession } from "./platform/platform.js";
export { isAgentEnvironment } from "./platform/agent-detect.js";

// Environment management
export { getEnvironmentManager, EnvironmentManager } from "./environment/EnvironmentManager.js";

// CLI
export { runSecrets } from "./cli/secrets-cli.js";
export type { SecretsOptions } from "./cli/secrets-cli.js";

// Key storage helpers
export { getKeyFromKeychain, storeKeyInKeychain, storeStringInKeychain, getStringFromKeychain, deleteFromKeychain } from "./crypto/vault-common.js";

// Validation
export { isValidKey } from "./vault/vault-utils.js";
