import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { X } from 'lucide-react';
import type { CommonUIProps } from '../types';
import { BrandMark } from './primitives';
import { Device } from './Device';
import { LoginScreen } from './LoginScreen';
import { SpacesScreen } from './SpacesScreen';
import { ChatScreen } from './ChatScreen';
import './styles.css';

const ease = [0.2, 0.7, 0.2, 1] as const;

export default function CommonUI(props: CommonUIProps) {
  const { screen, user } = props;
  const authed = (screen === 'spaces' || screen === 'chat') && user;
  const view = !authed ? (screen === 'loading' ? 'loading' : 'login') : screen === 'chat' && props.activeSpace ? 'chat' : 'spaces';
  const shell = view === 'loading' || view === 'login' ? 'auth' : 'app';

  return (
    <MotionConfig reducedMotion="user">
      <div className={`common-root${props.preview ? ' has-preview' : ''}`}>
        {props.preview && <span className="preview-badge">Preview</span>}

        <Device>
        <AnimatePresence mode="wait" initial={false}>
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
              <BrandMark size={30} className="breathe" />
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

              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={view === 'chat' ? `chat:${props.activeSpace?.id}` : view}
                  className="view"
                  initial={{ opacity: 0, x: view === 'chat' ? 14 : view === 'spaces' ? -14 : 0 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: view === 'chat' ? 14 : view === 'spaces' ? -14 : 0 }}
                  transition={{ duration: 0.18, ease }}
                >
                  {view === 'login' && <LoginScreen {...props} />}
                  {view === 'spaces' && user && (
                    <SpacesScreen
                      user={user}
                      spaces={props.spaces}
                      pendingInvitations={props.pendingInvitations}
                      isOnline={props.isOnline}
                      onSelectSpace={props.onSelectSpace}
                      onCreateSpace={props.onCreateSpace}
                      onAcceptInvitation={props.onAcceptInvitation}
                      onUpdateProfile={props.onUpdateProfile}
                      onSignOut={props.onSignOut}
                    />
                  )}
                  {view === 'chat' && user && props.activeSpace && (
                    <ChatScreen
                      user={user}
                      space={props.activeSpace}
                      messages={props.messages}
                      members={props.members}
                      invitations={props.invitations}
                      activities={props.activities}
                      isOnline={props.isOnline}
                      isLoadingMessages={props.isLoadingMessages}
                      hasMoreMessages={props.hasMoreMessages}
                      onBack={() => props.onSelectSpace(null)}
                      onSendMessage={props.onSendMessage}
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
