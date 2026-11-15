/**
 * Wire-format types.
 *
 * These mirror exactly what the SDK emits and what the engine consumes. They
 * are the contract between the two halves, so a field renamed on one side
 * shows up as a compile error rather than a silently missing signal.
 *
 * Optional/nullable fields are deliberate: every probe in the SDK can fail
 * independently (a getter may throw, a context may be unavailable), and
 * "unavailable" must be distinguishable from "zero".
 */

export interface MouseSample {
  t: number;
  x: number;
  y: number;
}

export interface EnvFacts {
  // identity
  ua: string;
  platform: string | null;
  vendor: string | null;
  languages: string[];
  uaMobileString: boolean;
  uaIOS: boolean;
  uaBrands: string[];
  uaMobile: boolean | null;
  uaPlatform: string | null;
  hasUAData: boolean;

  // automation + integrity
  webdriver: boolean | null;
  webdriverOwnProp: boolean;
  webdriverDesc: string | null;
  iframeWebdriver: boolean | null;
  navOwnTampered: string[];
  navNonNative: string[];
  permissionsQueryTampered: boolean | null;
  funcToStringTampered: boolean | null;
  suspiciousGlobals: string[];

  // capabilities
  maxTouchPoints: number | null;
  touchSupported: boolean | null;
  pointerCoarse: boolean | null;
  pointerFine: boolean | null;
  hoverNone: boolean | null;
  pluginsN: number | null;
  mimeN: number | null;
  pluginNames: string[];
  pdfViewerEnabled: boolean | null;
  chromeKeys: string[] | null;
  notifPermission: string | null;
  hardwareConcurrency: number | null;
  deviceMemory: number | null;
  connection: { et?: string; dl?: number; rtt?: number; save?: boolean } | null;

  // geometry
  screenW: number | null;
  screenH: number | null;
  availW: number | null;
  availH: number | null;
  colorDepth: number | null;
  innerW: number | null;
  innerH: number | null;
  outerW: number | null;
  outerH: number | null;
  screenX: number | null;
  screenY: number | null;
  dpr: number | null;
  vvScale: number | null;
  orientation: string | null;

  // locale / clock
  tz: string | null;
  locale: string | null;
  cal: string | null;
  tzOffset: number | null;

  // rendering
  glVendor: string | null;
  glRenderer: string | null;
  glExts: number | null;
  glMaxViewport: number | null;
  canvasMetrics: { serif: number; sans: number; mono: number; emoji: number; cjk: number } | null;
  audio: { sr: number; ch: number; lat: number } | null;
}

export interface MouseFacts {
  samples: MouseSample[];
  moveCount: number;
  pathLen: number;
  straightness: number | null;
  segCV: number | null;
  dtCV: number | null;
  zeroDt: number | null;
  intCoord: number | null;
  dirRate: number | null;
  teleportations: number;
  teleportMaxPx: number;
  teleportClicks: number;
  teleportRatio: number | null;
  clickDwellMean: number | null;
  clickDwellCV: number | null;
}

export interface TimingStat {
  median: number;
  cv: number | null;
  zeroRatio: number;
  n: number;
}

export interface KeyboardFacts {
  keys: number;
  gap: TimingStat;
  dwell: TimingStat;
  corrections: number;
  paste: number;
}

export interface BehaviorFacts {
  events: Record<string, number>;
  pointerTypes: Record<string, number>;
  totalMoves: number;
  firstInteractionMs: number | null;
  firstClickMs: number | null;
  clicks: number;
  touchStarts: number;
  touchMoves: number;
  touchMulti: number;
  touchDwellMedian: number | null;
  touchDwellMin: number | null;
  untrustedRatio: number;
  mouse: MouseFacts;
  keyboard: KeyboardFacts;
  scroll: { events: number; deltaCV: number | null; gapCV: number | null; medianGap: number };
  focus: { blur: number; hidden: number };
}

export interface FeaturePacket {
  v: 1;
  sid: string;
  ts: number;
  dur: number;
  page: { host: string; path: string; ref: string };
  env: EnvFacts;
  behavior: BehaviorFacts;
  perf: { dropped: number; initMs: number };
}

export type FamilyId = 'automation' | 'contradiction' | 'mouse' | 'keyboard' | 'touch' | 'integrity';

export interface SignalHit {
  id: string;
  label: string;
  family: FamilyId;
  points: number;
  evidence: string;
  /** Deterministic evidence (a contradiction or physical impossibility) rather
   *  than a statistical tendency. Certain hits escalate the verdict on their
   *  own; statistical hits need corroboration. */
  certain?: boolean;
}

export interface ScoreResult {
  score: number;
  band: 'human' | 'suspicious' | 'bot';
  confidence: 'high' | 'medium' | 'low';
  verdict: 'allow' | 'challenge' | 'block';
  families: { id: FamilyId; name: string; cap: number; points: number; raw: number; hits: SignalHit[] }[];
  top: SignalHit[];
  summary: string;
  /** True when at least one deterministic signal fired. */
  deterministic: boolean;
}
