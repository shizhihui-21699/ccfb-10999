/** Ambient declarations for non-standard browser surfaces the SDK probes. */

interface NavigatorUAData {
  readonly platform: string;
  readonly mobile: boolean;
  readonly brands: Array<{ brand: string; version: string }>;
}

interface Navigator {
  readonly userAgentData?: NavigatorUAData;
  readonly deviceMemory?: number;
}

interface Window {
  readonly chrome?: {
    runtime?: unknown;
    app?: unknown;
    csi?: unknown;
    loadTimes?: unknown;
  };
  webkitOfflineAudioContext?: typeof OfflineAudioContext;
}
