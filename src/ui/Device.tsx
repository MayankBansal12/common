import { createContext, useCallback, useContext, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { motion } from 'motion/react';
import { TONES, tone } from './palette';

// iPhone 15 Pro: 393×852 pt screen inside an 11px bezel and a 3.5px titanium band.
const SCREEN_W = 393;
const SCREEN_H = 852;
const DEVICE_W = SCREEN_W + 29;
const DEVICE_H = SCREEN_H + 29;
// Must match the `max-width: 640px` breakpoint in styles.css.
const BARE_QUERY = '(max-width: 640px)';

type ScreenValue = { container: HTMLElement | null; sheetOpened: () => () => void };
const ScreenContext = createContext<ScreenValue>({ container: null, sheetOpened: () => () => {} });

/** The phone's screen element, so Radix portals (dialogs, menus) render inside the device. */
export const useScreenContainer = () => useContext(ScreenContext).container ?? undefined;

/** While `open`, the app behind recedes into a card, like an iOS page sheet. */
export function useSheetStack(open: boolean) {
  const { sheetOpened } = useContext(ScreenContext);
  useEffect(() => (open ? sheetOpened() : undefined), [open, sheetOpened]);
}

const TintContext = createContext<(tint: number | undefined) => void>(() => {});

/** Tints the glow behind the phone (a palette index), e.g. to the colour of the open space. */
export function useAmbientTint(tint: number | undefined) {
  const set = useContext(TintContext);
  useEffect(() => {
    set(tint);
    return () => set(undefined);
  }, [tint, set]);
}

/** Glow colours behind the phone: the app's sage, lavender and sky, or shades of one tone when tinted. */
function glowColors(tint: number | undefined) {
  if (tint === undefined) return [TONES[2].soft, TONES[4].soft, TONES[0].soft];
  const t = tone(tint);
  return [t.soft, t.bg, t.soft];
}

const clockFormat = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });

/** The computer's local time, re-rendered on each minute boundary. */
function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let timer = 0;
    const tick = () => {
      setNow(new Date());
      timer = window.setTimeout(tick, 60_000 - (Date.now() % 60_000) + 20);
    };
    timer = window.setTimeout(tick, 60_000 - (Date.now() % 60_000) + 20);
    // Background tabs throttle timers; catch up as soon as the page is visible again.
    const onVisible = () => document.visibilityState === 'visible' && setNow(new Date());
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  // iOS shows the time without AM/PM.
  return clockFormat
    .formatToParts(now)
    .filter((part) => part.type !== 'dayPeriod')
    .map((part) => part.value)
    .join('')
    .trim();
}

function measure() {
  const bare = window.matchMedia(BARE_QUERY).matches;
  const scale = Math.max(0.5, Math.min(1, (window.innerHeight - 56) / DEVICE_H, (window.innerWidth - 40) / DEVICE_W));
  return { bare, scale };
}

function useFit() {
  const [fit, setFit] = useState(measure);
  useEffect(() => {
    const update = () => setFit(measure());
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return fit;
}

/** Renders the app inside an iPhone on wide screens; on phones the frame drops away and the app fills the viewport. */
export function Device({ children }: { children: ReactNode }) {
  const { bare, scale } = useFit();
  const [screen, setScreen] = useState<HTMLDivElement | null>(null);
  const [sheets, setSheets] = useState(0);
  const sheetOpened = useCallback(() => {
    setSheets((n) => n + 1);
    return () => setSheets((n) => n - 1);
  }, []);
  const value = useMemo(() => ({ container: screen, sheetOpened }), [screen, sheetOpened]);
  const stacked = sheets > 0 && !bare;
  const [tint, setTint] = useState<number | undefined>(undefined);
  return (
    <TintContext.Provider value={setTint}>
      {!bare && (
        <div className="page-glow" aria-hidden="true">
          {glowColors(tint).map((color, i) => (
            <motion.span
              key={i}
              className={`glow g${i}`}
              initial={false}
              animate={{ backgroundColor: color }}
              transition={{ duration: 1.6, ease: 'easeInOut', delay: i * 0.12 }}
            />
          ))}
        </div>
      )}
      <div
        className={`device-stage${bare ? ' bare' : ''}`}
        style={{ '--device-scale': scale, '--device-w': `${DEVICE_W}px`, '--device-h': `${DEVICE_H}px` } as CSSProperties}
      >
        <motion.div
          className="device"
          initial={bare ? false : { opacity: 0, y: 28 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 120, damping: 20, mass: 0.9 }}
        >
          {!bare && (
            <>
              <span className="device-key key-action" />
              <span className="device-key key-vol-up" />
              <span className="device-key key-vol-down" />
              <span className="device-key key-power" />
            </>
          )}
          <div className="device-bezel">
            <div className="device-screen" ref={setScreen}>
              {!bare && <StatusBar light={stacked} />}
              <motion.div
                className="device-app"
                initial={false}
                animate={stacked ? { scale: 0.92, y: 46, borderRadius: 18 } : { scale: 1, y: 0, borderRadius: bare ? 0 : 54 }}
                transition={{ type: 'spring', stiffness: 380, damping: 38, mass: 0.9 }}
              >
                <ScreenContext.Provider value={value}>{children}</ScreenContext.Provider>
              </motion.div>
              {!bare && (
                <>
                  <div className="device-island" aria-hidden="true">
                    <span className="device-lens" />
                  </div>
                  <div className="device-home" aria-hidden="true" />
                  <div className="device-glare" aria-hidden="true" />
                </>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </TintContext.Provider>
  );
}

function StatusBar({ light }: { light: boolean }) {
  const time = useClock();
  return (
    <div className="status-bar" data-light={light || undefined} aria-hidden="true">
      <span className="status-time">{time}</span>
      <span />
      <span className="status-icons">
        <svg width="18" height="12" viewBox="0 0 18 12" fill="currentColor">
          <rect x="0" y="7.5" width="3" height="4.5" rx="0.9" />
          <rect x="5" y="5" width="3" height="7" rx="0.9" />
          <rect x="10" y="2.5" width="3" height="9.5" rx="0.9" />
          <rect x="15" y="0" width="3" height="12" rx="0.9" />
        </svg>
        <svg width="16" height="12" viewBox="0 0 16 12" fill="currentColor">
          <path d="M8 2.4c2.3 0 4.4.9 6 2.4l1.2-1.2A10.2 10.2 0 0 0 8 .6C5.2.6 2.6 1.7.8 3.6L2 4.8a8.5 8.5 0 0 1 6-2.4Z" />
          <path d="M8 5.9c1.4 0 2.6.5 3.6 1.4l1.2-1.2A6.9 6.9 0 0 0 8 4.1c-1.9 0-3.5.7-4.8 2l1.2 1.2c1-.9 2.2-1.4 3.6-1.4Z" />
          <path d="M8 9.3c.5 0 .9.2 1.2.5L8 11.4 6.8 9.8c.3-.3.7-.5 1.2-.5Z" />
        </svg>
        <svg width="27" height="13" viewBox="0 0 27 13" fill="none">
          <rect x="0.5" y="0.5" width="23" height="12" rx="3.8" stroke="currentColor" opacity="0.38" />
          <rect x="2" y="2" width="20" height="9" rx="2.5" fill="currentColor" />
          <path d="M25 4.4v4.2c.8-.3 1.4-1.1 1.4-2.1S25.8 4.7 25 4.4Z" fill="currentColor" opacity="0.45" />
        </svg>
      </span>
    </div>
  );
}
