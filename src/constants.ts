/**
 * Application Constants
 */

// TIME CONSTANTS

/** One second in milliseconds */
export const ONE_SECOND_MS = 1000;

/** One minute in milliseconds (60 seconds) */
export const ONE_MINUTE_MS = 60 * ONE_SECOND_MS;

/** Two minutes in milliseconds */
export const TWO_MINUTES_MS = 2 * ONE_MINUTE_MS;

/** Three minutes in milliseconds */
export const THREE_MINUTES_MS = 3 * ONE_MINUTE_MS;

/** Five minutes in milliseconds */
export const FIVE_MINUTES_MS = 5 * ONE_MINUTE_MS;

/** Ten minutes in milliseconds */
export const TEN_MINUTES_MS = 10 * ONE_MINUTE_MS;

/** Twenty minutes in milliseconds */
export const TWENTY_MINUTES_MS = 20 * ONE_MINUTE_MS;

/** Thirty minutes in milliseconds */
export const THIRTY_MINUTES_MS = 30 * ONE_MINUTE_MS;

/** One hour in milliseconds */
export const ONE_HOUR_MS = 60 * ONE_MINUTE_MS;

/** Two hours in milliseconds */
export const TWO_HOURS_MS = 2 * ONE_HOUR_MS;

/** Four hours in milliseconds */
export const FOUR_HOURS_MS = 4 * ONE_HOUR_MS;

// DEFAULT TIMEOUTS AND INTERVALS

/** Default Telegram polling interval (10 seconds) */
export const DEFAULT_TELEGRAM_UPDATE_INTERVAL_MS = 10 * ONE_SECOND_MS;

/** Default ask user timeout (5 minutes) */
export const DEFAULT_ASK_USER_TIMEOUT_MS = FIVE_MINUTES_MS;

/** Default Copilot operation timeout (1 hour) */
export const DEFAULT_COPILOT_OPERATION_TIMEOUT_MS = ONE_HOUR_MS;

/** Default heartbeat warning interval (5 minutes) */
export const DEFAULT_HEARTBEAT_WARNING_INTERVAL_MS = FIVE_MINUTES_MS;

/** Default heartbeat update interval (2 minutes) */
export const DEFAULT_HEARTBEAT_UPDATE_INTERVAL_MS = TWO_MINUTES_MS;

/** Default timeout extension duration (20 minutes) */
export const DEFAULT_TIMEOUT_EXTENSION_MS = TWENTY_MINUTES_MS;

/** Default maximum timeout duration (2 hours) */
export const DEFAULT_MAX_TIMEOUT_DURATION_MS = TWO_HOURS_MS;

/** Default timeout confirmation time (10 minutes) */
export const DEFAULT_TIMEOUT_CONFIRMATION_TIME_MS = TEN_MINUTES_MS;

/** Default stale period threshold (5 minutes) */
export const DEFAULT_STALE_PERIOD_THRESHOLD_MS = FIVE_MINUTES_MS;

/** Default keyboard TTL (5 minutes) */
export const DEFAULT_KEYBOARD_TTL_MS = FIVE_MINUTES_MS;

/** Auto-extension check interval (30 seconds) */
export const AUTO_EXTENSION_CHECK_INTERVAL_MS = 30 * ONE_SECOND_MS;

/** Activity window for auto-extension (3 minutes) */
export const ACTIVITY_WINDOW_MS = THREE_MINUTES_MS;

/** Wizard timeout (5 minutes) */
export const WIZARD_TIMEOUT_MS = FIVE_MINUTES_MS;

/** Stability period for crash recovery (30 seconds) */
export const STABILITY_PERIOD_MS = 30 * ONE_SECOND_MS;

/** Allowlist setup delay (2 seconds) */
export const ALLOWLIST_SETUP_DELAY_MS = 2 * ONE_SECOND_MS;

/** Graceful shutdown timeout (10 seconds) */
export const GRACEFUL_SHUTDOWN_TIMEOUT_MS = 10 * ONE_SECOND_MS;

// TIMEOUT LIMITS

/** Minimum allowed timeout (1 second) */
export const MIN_TIMEOUT_MS = ONE_SECOND_MS;

/** Minimum retry delay (100 ms) */
export const MIN_RETRY_DELAY_MS = 100;

/** Maximum retry delay (1 minute) */
export const MAX_RETRY_DELAY_MS = ONE_MINUTE_MS;

/** Minimum operation timeout (1 second) */
export const MIN_OPERATION_TIMEOUT_MS = ONE_SECOND_MS;

/** Maximum operation timeout (2 hours) */
export const MAX_OPERATION_TIMEOUT_MS = TWO_HOURS_MS;

/** Minimum timeout extension (1 minute) */
export const MIN_TIMEOUT_EXTENSION_MS = ONE_MINUTE_MS;

/** Maximum timeout extension (1 hour) */
export const MAX_TIMEOUT_EXTENSION_MS = ONE_HOUR_MS;

/** Minimum max timeout duration (1 minute) */
export const MIN_MAX_TIMEOUT_DURATION_MS = ONE_MINUTE_MS;

/** Maximum max timeout duration (4 hours) */
export const MAX_MAX_TIMEOUT_DURATION_MS = FOUR_HOURS_MS;

/** Minimum timeout confirmation time (1 minute) */
export const MIN_TIMEOUT_CONFIRMATION_MS = ONE_MINUTE_MS;

/** Maximum timeout confirmation time (30 minutes) */
export const MAX_TIMEOUT_CONFIRMATION_MS = THIRTY_MINUTES_MS;

/** Minimum stale period threshold (1 minute) */
export const MIN_STALE_PERIOD_MS = ONE_MINUTE_MS;

/** Maximum stale period threshold (30 minutes) */
export const MAX_STALE_PERIOD_MS = THIRTY_MINUTES_MS;

/** Minimum keyboard TTL (1 minute) */
export const MIN_KEYBOARD_TTL_MS = ONE_MINUTE_MS;

/** Maximum keyboard TTL (1 hour) */
export const MAX_KEYBOARD_TTL_MS = ONE_HOUR_MS;

/** Maximum retry delay limit (5 minutes) */
export const MAX_RETRY_DELAY_LIMIT_MS = FIVE_MINUTES_MS;

// RETRY CONSTANTS

/** Default maximum retry attempts for Telegram API */
export const DEFAULT_TELEGRAM_RETRY_MAX_ATTEMPTS = 10;

/** Default initial retry delay (1 second) */
export const DEFAULT_TELEGRAM_RETRY_INITIAL_DELAY_MS = ONE_SECOND_MS;

/** Default maximum retry delay (32 seconds) */
export const DEFAULT_TELEGRAM_RETRY_MAX_DELAY_MS = 32 * ONE_SECOND_MS;

/** Minimum retry attempts */
export const MIN_RETRY_ATTEMPTS = 1;

/** Maximum retry attempts */
export const MAX_RETRY_ATTEMPTS = 100;

// SIZE CONSTANTS

/** Bytes per kilobyte */
export const BYTES_PER_KB = 1024;

/** Bytes per megabyte */
export const BYTES_PER_MB = 1024 * BYTES_PER_KB;

/** Bytes per gigabyte */
export const BYTES_PER_GB = 1024 * BYTES_PER_MB;

/** Minimum input size (1 KB) */
export const MIN_INPUT_SIZE_BYTES = 1 * BYTES_PER_KB;

/** Maximum input size (100 MB) */
export const MAX_INPUT_SIZE_BYTES = 100 * BYTES_PER_MB;

/** Default input size limit (1 MB) */
export const DEFAULT_INPUT_SIZE_BYTES = 1 * BYTES_PER_MB;

/** Minimum buffer size (10 KB) */
export const MIN_BUFFER_SIZE_BYTES = 10 * BYTES_PER_KB;

/** Maximum buffer size (500 MB) */
export const MAX_BUFFER_SIZE_BYTES = 500 * BYTES_PER_MB;

/** Default buffer size limit (5 MB) */
export const DEFAULT_BUFFER_SIZE_BYTES = 5 * BYTES_PER_MB;

/** Maximum file size for tools (50 MB) */
export const MAX_TOOL_FILE_SIZE_BYTES = 50 * BYTES_PER_MB;

// MESSAGE AND TEXT CONSTANTS

/** Telegram maximum message length (4096 characters) */
export const TELEGRAM_MAX_MESSAGE_LENGTH = 4096;

/** Telegram maximum callback data length (64 bytes) */
export const TELEGRAM_MAX_CALLBACK_DATA_LENGTH = 64;

/** Maximum text length for sanitization (1000 characters) */
export const MAX_SANITIZE_TEXT_LENGTH = 1000;

/** Maximum event data preview length (200 characters) */
export const MAX_EVENT_DATA_PREVIEW_LENGTH = 200;

/** Maximum depth for sanitization recursion */
export const MAX_SANITIZE_DEPTH = 10;

// SESSION AND LIMIT CONSTANTS

/** Default maximum concurrent sessions */
export const DEFAULT_MAX_SESSIONS = 5;

/** Auto-extension threshold (70%) */
export const AUTO_EXTENSION_THRESHOLD = 0.7;

// HTTP STATUS CODES

/** HTTP Unauthorized status */
export const HTTP_STATUS_UNAUTHORIZED = 401;

/** HTTP Forbidden status */
export const HTTP_STATUS_FORBIDDEN = 403;
