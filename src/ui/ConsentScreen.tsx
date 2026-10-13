import { useEffect, useState, type FormEvent } from 'react';
import { motion } from 'motion/react';
import { ArrowUpRight, Check, Clock } from 'lucide-react';
import type { AgentGrant, ConsentProps, Person, Space } from '../types';
import { Avatar, BrandMark, InlineError, Spinner } from './primitives';
import { AgentFace } from './agents';
import { DEFAULT_GRANT_SCOPES, GrantForm } from './AgentsSheet';
import { useAction } from './hooks';

const ease = [0.2, 0.7, 0.2, 1] as const;

/** An agent asks to connect; only reading and sending start checked. */
export function ConsentScreen({ consent, user, spaces }: { consent: ConsentProps; user: Person; spaces: Space[] }) {
  const { request } = consent;
  const [grant, setGrant] = useState<AgentGrant>({ name: '', scopes: [], spaceMode: 'all', spaceIds: [] });
  const [leaving, setLeaving] = useState<'approved' | 'denied' | null>(null);
  const approve = useAction();
  const deny = useAction();
  const busy = approve.busy || deny.busy || leaving !== null;
  // Deciding consumes the request, so remember where the person is headed while the browser leaves.
  const [host, setHost] = useState('');

  useEffect(() => {
    if (request.status === 'ready') setHost(request.redirectHost);
    if (request.status === 'ready') setGrant({ name: request.clientName.slice(0, 40), scopes: DEFAULT_GRANT_SCOPES.filter((s) => request.requestedScopes.includes(s)), spaceMode: 'all', spaceIds: [] });
  }, [request.status]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !grant.name.trim()) return;
    if (await approve.run(() => consent.onApprove({ ...grant, name: grant.name.trim() }))) setLeaving('approved');
  }

  return (
    <div className="screen consent">
      <header className="bar">
        <div className="wordmark">
          <BrandMark size={20} />
          <span>Common</span>
        </div>
      </header>
      <div className="scroll">
        <motion.div className="consent-inner" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease }}>
          {request.status === 'loading' && !leaving && (
            <div className="consent-center" role="status">
              <Spinner size={18} />
              <span className="sr-only">Loading the connection request</span>
            </div>
          )}

          {request.status === 'expired' && !leaving && (
            <div className="consent-center">
              <span className="consent-icon" aria-hidden="true">
                <Clock size={20} />
              </span>
              <h1 className="consent-title">This request has expired</h1>
              <p className="consent-sub">Requests last ten minutes. Start again from your agent.</p>
              <button type="button" className="btn btn-primary btn-lg btn-block" onClick={consent.onDismiss}>
                Go to my spaces
              </button>
            </div>
          )}

          {leaving && (
            <div className="consent-center" role="status">
              <span className="consent-icon ok" aria-hidden="true">
                {leaving === 'approved' ? <Check size={20} /> : <ArrowUpRight size={20} />}
              </span>
              <h1 className="consent-title">{leaving === 'approved' ? 'Connected' : 'Not connected'}</h1>
              <p className="consent-sub">Taking you back to {host}…</p>
            </div>
          )}

          {request.status === 'ready' && !leaving && (
            <form className="stack" onSubmit={submit}>
              <div className="consent-head">
                <div className="consent-pair" aria-hidden="true">
                  <AgentFace size={44} />
                  <span className="consent-link" />
                  <Avatar person={user} size={44} />
                </div>
                <h1 className="consent-title">
                  {request.clientName} wants to connect to your Common, {user.name}.
                </h1>
              </div>
              <GrantForm value={grant} onChange={setGrant} spaces={spaces} requested={request.requestedScopes} disabled={busy} />
              <InlineError>{approve.error ?? deny.error}</InlineError>
              <div className="consent-actions">
                <button
                  type="button"
                  className="btn btn-outline btn-lg"
                  disabled={busy}
                  onClick={() => void deny.run(async () => { setLeaving('denied'); try { await consent.onDeny(); } catch (e) { setLeaving(null); throw e; } })}
                >
                  {deny.busy && <Spinner />}
                  Don’t allow
                </button>
                <button type="submit" className="btn btn-primary btn-lg" disabled={busy || !grant.name.trim()}>
                  {approve.busy && <Spinner />}
                  Allow
                </button>
              </div>
              <p className="field-note center">Change or remove it any time from your account menu.</p>
            </form>
          )}
        </motion.div>
      </div>
    </div>
  );
}
