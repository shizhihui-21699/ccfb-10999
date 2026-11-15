/** Ambient globals the test harness page exposes (declared by the SDK bundle). */

interface Window {
  BotGuard?: {
    start: () => void;
    stop: () => void;
    flush: (finalBeacon?: boolean) => void;
    getSessionId: () => string;
  };
  BotGuardSDK?: {
    init: (config: Record<string, unknown>) => unknown;
  };
  __bgFlush: () => Promise<void>;
}
