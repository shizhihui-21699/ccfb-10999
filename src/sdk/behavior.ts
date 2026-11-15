/**
 * Behaviour collector.
 *
 * Design constraints that shaped this file:
 *  - Listener callbacks must stay in the microsecond range: Passive listeners
 *    only, no DOM reads, no layout, no allocation inside the hot path beyond
 *    writing into preallocated numeric arrays.
 *  - Nothing here may throw into the host page. Every entry point is wrapped.
 *  - The raw stream never leaves the device. Only aggregates and a small
 *    downsampled trajectory go into the packet, which keeps the payload
 *    small and keeps raw human input (potentially PII) on the client.
 */

interface Geo { t: number; x: number; y: number }

const MAX_POINTS = 256;

export interface BehaviourCollector {
  facts: () => any;
  snapshot: () => any;
}

export function collectBehavior(now = () => performance.now()): BehaviourCollector {
  const t0 = now();
  const events: Record<string, number> = Object.create(null);
  const pointerTypes: Record<string, number> = Object.create(null);

  // Preallocated ring for mouse geometry. We store the first MAX_POINTS
  // points of the session: the opening trajectory is the most diagnostic
  // (bots usually fire a handful of synthetic moves and then click).
  const gx = new Float64Array(MAX_POINTS);
  const gy = new Float64Array(MAX_POINTS);
  const gt = new Float64Array(MAX_POINTS);
  let nPts = 0;
  let totalMoves = 0;

  let firstInteraction: number | null = null;
  // First click is tracked separately: a pointer already resting over the
  // page produces a pointermove the instant it loads, which is normal, while
  // a click within a few milliseconds of load is not.
  let firstClick: number | null = null;
  let clicks = 0;
  const clickStarts: number[] = [];
  let touchStarts = 0;
  let touchMoves = 0;
  const touchDurations: number[] = [];
  let touchDownAt = 0;
  let touchMulti = 0;
  let untrusted = 0;
  let trustedCount = 0;

  // click bookkeeping
  let teleportClicks = 0;
  let lastMoveX = NaN, lastMoveY = NaN, lastMoveT = 0;
  const dwells: number[] = [];
  let downAt = 0;

  // keyboard bookkeeping
  const keyGaps: number[] = [];
  const keyDwell: number[] = [];
  let keysDown = 0;
  let keysSeen = 0;
  let corrections = 0;
  let pasted = 0;
  let lastKeyDownAt = 0;
  let lastKeyUpAt = 0;

  // scroll bookkeeping
  const scrollDeltas: number[] = [];
  let scrollEvents = 0;
  let scrollGaps: number[] = [];
  let lastScrollAt = 0;

  let blurCount = 0;
  let hiddenCount = 0;

  const bump = (k: string) => { events[k] = (events[k] || 0) + 1; };
  const noteInteraction = () => {
    if (firstInteraction === null) firstInteraction = now() - t0;
  };
  const noteTrust = (e: Event) => {
    if (e.isTrusted) trustedCount++; else untrusted++;
  };

  const onPointerMove = (e: PointerEvent) => {
    const t = now() - t0;
    if (firstInteraction === null) firstInteraction = t;
    totalMoves++;
    const pt = e.pointerType || 'unknown';
    pointerTypes[pt] = (pointerTypes[pt] || 0) + 1;
    lastMoveX = e.clientX; lastMoveY = e.clientY; lastMoveT = t;
    if (nPts < MAX_POINTS) {
      gx[nPts] = e.clientX; gy[nPts] = e.clientY; gt[nPts] = t; nPts++;
    }
  };

  const onPointerDown = (e: PointerEvent) => {
    noteInteraction();
    noteTrust(e);
    bump(e.type);
    downAt = now() - t0;
    clickStarts.push(nPts);
    // A click that arrives with the cursor never having travelled there is a
    // strong automation signature: Playwright and Selenium both jump.
    if (e.pointerType !== 'touch') {
      if (firstClick === null) firstClick = downAt;
      clicks++;
      if (Number.isNaN(lastMoveX)) {
        teleportClicks++;
      } else {
        const dx = e.clientX - lastMoveX, dy = e.clientY - lastMoveY;
        if (Math.sqrt(dx * dx + dy * dy) > 90 && downAt - lastMoveT < 60) teleportClicks++;
      }
    }
  };

  const onPointerUp = (e: PointerEvent) => {
    noteTrust(e);
    bump(e.type);
    if (e.pointerType !== 'touch') {
      const d = now() - t0 - downAt;
      if (d >= 0 && d < 5000) dwells.push(d);
    }
  };

  const onClick = (e: MouseEvent) => { noteTrust(e); bump('click'); };

  const onKeyDown = (e: KeyboardEvent) => {
    noteInteraction();
    noteTrust(e);
    const t = now() - t0;
    if (lastKeyUpAt > 0 && t > lastKeyUpAt) keyGaps.push(t - lastKeyUpAt);
    lastKeyDownAt = t;
    keysDown++;
    keysSeen++;
    if (e.key === 'Backspace' || e.key === 'Delete') corrections++;
    if ((e.ctrlKey || e.metaKey) && (e.key === 'v' || e.key === 'V')) pasted = 1;
    bump('keydown');
  };
  const onKeyUp = (e: KeyboardEvent) => {
    const t = now() - t0;
    if (lastKeyDownAt > 0 && t > lastKeyDownAt) keyDwell.push(t - lastKeyDownAt);
    lastKeyUpAt = t;
    keysDown = Math.max(0, keysDown - 1);
    bump('keyup');
  };

  const onTouchStart = (e: TouchEvent) => {
    noteInteraction();
    touchStarts++;
    touchDownAt = now() - t0;
    if (e.touches && e.touches.length > 1) touchMulti++;
    bump('touchstart');
  };
  const onTouchMove = () => { touchMoves++; bump('touchmove'); };
  const onTouchEnd = () => {
    const d = now() - t0 - touchDownAt;
    if (touchDownAt > 0 && d >= 0 && d < 10000) touchDurations.push(d);
    bump('touchend');
  };

  const onScroll = (e: Event) => {
    scrollEvents++;
    const t = now() - t0;
    if (lastScrollAt) scrollGaps.push(t - lastScrollAt);
    lastScrollAt = t;
  };
  const onWheel = (e: WheelEvent) => {
    if (scrollDeltas.length < 64) scrollDeltas.push(Math.abs(e.deltaY));
    bump('wheel');
  };

  const onPaste = () => { pasted = 1; bump('paste'); };
  const onBlur = () => { blurCount++; };
  const onVis = () => { if (document.visibilityState === 'hidden') hiddenCount++; };

  const opts = { passive: true, capture: true } as AddEventListenerOptions;
  const on = (t: string, fn: any, o: any = opts) => { try { window.addEventListener(t, fn, o); } catch { /* ignore */ } };

  on('pointermove', onPointerMove);
  on('pointerdown', onPointerDown);
  on('pointerup', onPointerUp);
  on('mouseup', onPointerUp);
  on('mousedown', (e: MouseEvent) => { noteTrust(e); bump('mousedown'); });
  on('click', onClick);
  on('keydown', onKeyDown);
  on('keyup', onKeyUp);
  on('input', () => bump('input'));
  on('touchstart', onTouchStart);
  on('touchmove', onTouchMove);
  on('touchend', onTouchEnd);
  on('touchcancel', onTouchEnd);
  on('scroll', onScroll);
  on('wheel', onWheel);
  on('paste', onPaste, { passive: true, capture: true });
  on('blur', onBlur, { passive: true });
  on('visibilitychange', onVis, { passive: true });

  const stats = (a: number[]) => {
    const n = a.length;
    if (!n) return { n: 0, median: 0, cv: null as number | null, zeroRatio: 0, min: 0, max: 0 };
    const s = a.slice().sort((p, q) => p - q);
    const median = s[n >> 1];
    let sum = 0, sum2 = 0, zeros = 0;
    for (const v of a) { sum += v; sum2 += v * v; if (v === 0) zeros++; }
    const mean = sum / n;
    const varr = Math.max(0, sum2 / n - mean * mean);
    const sd = Math.sqrt(varr);
    return { n, median, cv: mean > 0 ? sd / mean : null, zeroRatio: zeros / n, min: s[0], max: s[n - 1] };
  };

  const geometry = () => {
    const n = nPts;
    if (n < 2) {
      return { pathLen: 0, straightness: null, segCV: null, dtCV: null, zeroDt: null, intCoord: null, dirRate: null, teleportations: 0, teleportMaxPx: 0, samples: [] as Geo[] };
    }
    // Split the ring into "strokes": a stroke ends at a click, or wherever
    // the pointer sat idle long enough that the next sample is a jump rather
    // than a continuation. Without this, an idle gap or a second, unrelated
    // approach is glued to the first and fabricates a near-straight line.
    const IDLE_GAP = 120;
    const strokeEnds: number[] = [];
    for (let i = 1; i < n; i++) {
      const clicked = clickStarts.indexOf(i) >= 0;
      if (clicked || gt[i] - gt[i - 1] > IDLE_GAP) strokeEnds.push(i);
    }
    if (strokeEnds[strokeEnds.length - 1] !== n) strokeEnds.push(n);

    let path = 0;
    const segs: number[] = [];
    const dts: number[] = [];
    let zeroDt = 0;
    let intCoord = 0;
    let dirChanges = 0;
    let stepCount = 0;
    // Discontinuities. Synthetic dispatch teleports the pointer: it reports
    // the position the OS cursor happened to be at, then the coordinates it
    // wants, with no intermediate samples. Real motion is continuous even at
    // a fast flick (a gaming mouse peaks near 15,000 px/s). Anything above
    // 20,000 px/s moving at least 60px is treated as a break, not as travel:
    // counting it would both inflate path length and mask a straight-line
    // movement that follows.
    let teleportations = 0;
    let teleportMaxPx = 0;
    let net = 0;
    let startIdx = 0;
    for (const end of strokeEnds) {
      let prevAngle = NaN;
      // Start of the current unbroken run; a jump restarts it so net
      // displacement is never measured across a discontinuity.
      let runStart = startIdx;
      const closeRun = (last: number) => {
        if (last - runStart >= 1) {
          net += Math.sqrt((gx[last] - gx[runStart]) ** 2 + (gy[last] - gy[runStart]) ** 2);
        }
      };
      for (let i = startIdx + 1; i < end; i++) {
        const dx = gx[i] - gx[i - 1], dy = gy[i] - gy[i - 1];
        const len = Math.sqrt(dx * dx + dy * dy);
        const dt = gt[i] - gt[i - 1];
        // Discontinuity: treat as a new stroke rather than as movement, so it
        // neither inflates path length nor fabricates a straight line.
        const velocity = dt > 0 ? len / dt * 1000 : Infinity;
        if (len >= 60 && velocity >= 20000) {
          teleportations++;
          if (len > teleportMaxPx) teleportMaxPx = len;
          closeRun(i - 1);
          runStart = i;
          prevAngle = NaN;
          continue;
        }
        path += len;
        segs.push(len);
        dts.push(dt);
        stepCount++;
        if (dt <= 0.5) zeroDt++;
        if ((gx[i] * 100) % 100 === 0 && (gy[i] * 100) % 100 === 0) intCoord++;
        const ang = Math.atan2(dy, dx);
        if (!Number.isNaN(prevAngle)) {
          let d = Math.abs(ang - prevAngle);
          if (d > Math.PI) d = Math.PI * 2 - d;
          if (d > 0.35) dirChanges++;
        }
        prevAngle = ang;
      }
      closeRun(end - 1);
      startIdx = end;
    }
    if (!stepCount) {
      return { pathLen: 0, straightness: null, segCV: null, dtCV: null, zeroDt: null, intCoord: null, dirRate: null, teleportations, teleportMaxPx: Math.round(teleportMaxPx), samples: [] as Geo[] };
    }
    const segStat = stats(segs);
    const dtStat = stats(dts);
    // Downsample to at most 48 points for the wire, preserving shape via
    // uniform stride. Keeps the packet well under a kilobyte.
    const stride = Math.max(1, Math.ceil(n / 48));
    const samples: Geo[] = [];
    for (let i = 0; i < n; i += stride) samples.push({ t: Math.round(gt[i]), x: Math.round(gx[i]), y: Math.round(gy[i]) });
    return {
      pathLen: Math.round(path),
      straightness: path > 0 ? net / path : null,
      segCV: segStat.cv,
      dtCV: dtStat.cv,
      zeroDt: zeroDt / stepCount,
      intCoord: intCoord / stepCount,
      dirChanges,
      dirRate: dirChanges / Math.max(1, stepCount),
      teleportations,
      teleportMaxPx: Math.round(teleportMaxPx),
      samples,
    };
  };

  const factsFn = () => {
    const g = geometry();
    const kGap = stats(keyGaps);
    const kDwell = stats(keyDwell);
    const sDelta = stats(scrollDeltas);
    const sGap = stats(scrollGaps);
    return {
      events,
      pointerTypes,
      totalMoves,
      firstInteractionMs: firstInteraction,
      firstClickMs: firstClick,
      clicks,
      touchStarts,
      touchMoves,
      touchMulti,
      touchDwellMedian: (() => {
        if (!touchDurations.length) return null;
        const sorted = touchDurations.slice().sort((a, b) => a - b);
        return sorted[sorted.length >> 1];
      })(),
      touchDwellMin: touchDurations.length ? Math.min(...touchDurations) : null,
      untrustedRatio: trustedCount + untrusted > 0 ? untrusted / (trustedCount + untrusted) : 0,
      mouse: {
        samples: g.samples,
        moveCount: nPts,
        pathLen: g.pathLen,
        straightness: g.straightness,
        segCV: g.segCV,
        dtCV: g.dtCV,
        zeroDt: g.zeroDt,
        intCoord: g.intCoord,
        dirRate: g.dirRate,
        teleportations: g.teleportations,
        teleportMaxPx: g.teleportMaxPx,
        teleportClicks,
        teleportRatio: clicks > 0 ? teleportClicks / clicks : null,
        clickDwellMean: dwells.length ? dwells.reduce((a, b) => a + b, 0) / dwells.length : null,
        clickDwellCV: stats(dwells).cv,
      },
      keyboard: {
        keys: keysSeen,
        gap: { median: kGap.median, cv: kGap.cv, zeroRatio: kGap.zeroRatio, n: kGap.n, min: kGap.min },
        dwell: { median: kDwell.median, cv: kDwell.cv, zeroRatio: kDwell.zeroRatio, n: kDwell.n },
        corrections,
        paste: pasted,
      },
      scroll: {
        events: scrollEvents,
        deltaCV: sDelta.cv,
        gapCV: sGap.cv,
        medianGap: sGap.median,
      },
      focus: { blur: blurCount, hidden: hiddenCount },
    };
  };

  return { facts: factsFn, snapshot: factsFn };
}
