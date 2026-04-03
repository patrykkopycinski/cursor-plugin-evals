/**
 * Centralized constants for service identification, data directories,
 * CLI branding, and repository URLs.
 *
 * These are used across OTel spans, cache directories, badge output,
 * CI templates, and reporting footers. Having them in one place means
 * the port to `agent-skill-eval` only needs to change values here.
 */

export const SERVICE_NAME = 'cursor-plugin-evals';

export const DATA_DIR = `.${SERVICE_NAME}`;

/** The CLI binary name used in npx commands and help text. */
export const CLI_NAME = SERVICE_NAME;

/** The canonical GitHub repository URL. */
export const REPO_URL = 'https://github.com/patrykkopycinski/cursor-plugin-evals';
