import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { X } from 'lucide-react';
import type { CommonUIProps } from '../types';
import { AnimatedMark } from './primitives';
import { SITE } from '../site';
import { Device } from './Device';
import { LoginScreen } from './LoginScreen';
import { SpacesScreen } from './SpacesScreen';
import { ChatScreen } from './ChatScreen';
import { ConsentScreen } from './ConsentScreen';
import './styles.css';

const ease = [0.2, 0.7, 0.2, 1] as const;

export default function CommonUI(props: CommonUIProps) {
  const { screen, user } = props;
  const authed = (screen === 'spaces' || screen === 'chat') && user;
  // A pending agent connection takes over once signed in, until it's decided or dismissed.
  const ready = !authed ? (screen === 'loading' ? 'loading' : 'login') : props.consent ? 'consent' : screen === 'chat' && props.activeSpace ? 'chat' : 'spaces';
  const splash = useSplashGate(ready === 'loading');
  // While a shown splash finishes its minimum time, keep it on screen even though loading is done.
  const view = splash.holding ? 'loading' : ready;
  const shell = view === 'loading' || view === 'login' ? 'auth' : 'app';

  return (
    <MotionConfig reducedMotion="user">
      <div className="common-root">

        <Device>
        {/* Entrance animations run on first load too, so the splash and first screen assemble. */}
        <AnimatePresence mode="wait">
          {view === 'loading' ? (
            <motion.div
              key="loading"
              className="loading"
              role="status"
              aria-label="Loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
            >
              {splash.visible && <Splash />}
            </motion.div>
          ) : (
            <motion.main
              key={shell}
              className={`shell shell-${shell}`}
              initial={{ opacity: 0, y: 8, scale: 0.99 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -4, scale: 0.995 }}
              transition={{ duration: 0.26, ease }}
            >
              {shell === 'app' && (
                <AnimatePresence>
                  {props.error && (
                    <motion.div
                      className="toast"
                      role="alert"
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 36 }}
                    >
                      <span>{props.error}</span>
                      <button type="button" className="icon-btn xs" aria-label="Dismiss" title="Dismiss" onClick={props.onDismissError}>
                        <X size={13} />
                      </button>
                    </motion.div>
                  )}
                </AnimatePresence>
              )}

              <AnimatePresence mode="wait">
                <motion.div
                  key={view === 'chat' ? `chat:${props.activeSpace?.id}` : view}
                  className="view"
                  initial={{ opacity: 0, x: view === 'chat' ? 14 : view === 'spaces' ? -14 : 0 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: view === 'chat' ? 14 : view === 'spaces' ? -14 : 0 }}
                  transition={{ duration: 0.18, ease }}
                >
                  {view === 'login' && <LoginScreen {...props} />}
                  {view === 'consent' && user && props.consent && <ConsentScreen consent={props.consent} user={user} spaces={props.spaces} />}
                  {view === 'spaces' && user && (
                    <SpacesScreen
                      user={user}
                      spaces={props.spaces}
                      pendingInvitations={props.pendingInvitations}
                      isLoading={props.isLoadingSpaces}
                      isOnline={props.isOnline}
                      onSelectSpace={props.onSelectSpace}
                      onCreateSpace={props.onCreateSpace}
                      onAcceptInvitation={props.onAcceptInvitation}
                      onUpdateProfile={props.onUpdateProfile}
                      onSignOut={props.onSignOut}
                      agents={props.agents}
                      openAgents={props.openAgents}
                    />
                  )}
                  {view === 'chat' && user && props.activeSpace && (
                    <ChatScreen
                      user={user}
                      space={props.activeSpace}
                      messages={props.messages}
                      typing={props.typing}
                      members={props.members}
                      spaces={props.spaces}
                      agents={props.agents}
                      invitations={props.invitations}
                      activities={props.activities}
                      isOnline={props.isOnline}
                      isLoadingMessages={props.isLoadingMessages}
                      hasMoreMessages={props.hasMoreMessages}
                      onBack={() => props.onSelectSpace(null)}
                      onSendMessage={props.onSendMessage}
                      onTyping={props.onTyping}
                      onRetryMessage={props.onRetryMessage}
                      onLoadMoreMessages={props.onLoadMoreMessages}
                      onInviteMember={props.onInviteMember}
                      onRemoveMember={props.onRemoveMember}
                      onRevokeInvite={props.onRevokeInvite}
                      onUpdateSpace={props.onUpdateSpace}
                    />
                  )}
                </motion.div>
              </AnimatePresence>
            </motion.main>
          )}
        </AnimatePresence>
        </Device>
      </div>
    </MotionConfig>
  );
}

// Fast loads shouldn't flash a splash; slow ones shouldn't cut its animation short.
const SPLASH_DELAY = 250;
const SPLASH_MIN = 1100;

/**
 * Decides when the splash shows: only once loading has lasted SPLASH_DELAY, and, once shown, for at
 * least SPLASH_MIN so the mark finishes assembling. Before the delay the screen stays quietly blank.
 */
function useSplashGate(loading: boolean) {
  const [visible, setVisible] = useState(false);
  const [holding, setHolding] = useState(false);
  const shownAt = useRef(0);
  useEffect(() => {
    if (loading) {
      setHolding(false);
      if (visible) return;
      const t = setTimeout(() => {
        shownAt.current = Date.now();
        setVisible(true);
      }, SPLASH_DELAY);
      return () => clearTimeout(t);
    }
    if (!visible) return;
    const left = SPLASH_MIN - (Date.now() - shownAt.current);
    if (left <= 0) {
      setVisible(false);
      return;
    }
    setHolding(true);
    const t = setTimeout(() => {
      setHolding(false);
      setVisible(false);
    }, left);
    return () => clearTimeout(t);
  }, [loading, visible]);
  return { visible, holding };
}

/** Loading: the mark assembles as in onboarding, the name and short line follow, and a soft ripple keeps it alive. */
function Splash() {
  const rise = (delay: number) => ({
    initial: { opacity: 0, y: 8 },
    animate: { opacity: 1, y: 0 },
    transition: { duration: 0.5, delay, ease },
  });
  return (
    <div className="splash">
      <motion.span className="splash-mark" initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', stiffness: 260, damping: 20 }}>
        <span className="splash-ripple" aria-hidden="true" />
        <AnimatedMark size={54} delay={0.1} strokeWidth={1.4} />
      </motion.span>
      <motion.span className="splash-name" {...rise(0.35)}>
        {SITE.name}
      </motion.span>
      <motion.span className="splash-line" {...rise(0.45)}>
        {SITE.short}
      </motion.span>
    </div>
  );
}
