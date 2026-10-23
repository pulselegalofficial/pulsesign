import type { APIRoute } from 'astro';
import { findByHash, getEvents } from '../../lib/docs';
import { describeUserAgent } from '../../lib/format';
import { actorLabel, dict, fill } from '../../lib/i18n';
import { json } from '../../lib/http';

/**
 * Public hash lookup. Only someone holding the exact signed file can produce
 * its hash, so a match returns the evidence that is no longer printed on the
 * certificate: each signer's IP and device, and the full audit trail.
 * Unknown hashes get nothing. Emails are not returned.
 */
export const GET: APIRoute = async ({ url, locals }) => {
  const hash = (url.searchParams.get('hash') || '').toLowerCase();
  const found = await findByHash(hash);
  if (!found) return json({ match: false });
  const { doc, signers } = found;
  const t = dict(locals.lang) as unknown as Record<string, string>;
  const events = await getEvents(doc.id);
  return json({
    match: true,
    doc: {
      id: doc.id,
      title: doc.title,
      completedAt: doc.completed_at,
      signers: signers.map((s) => ({
        name: s.name,
        signedAt: s.signed_at,
        ip: s.ip || '',
        device: describeUserAgent(s.user_agent),
      })),
      events: events.map((e) => ({
        at: e.at,
        label: fill(t[`ev_${e.type}`] || e.type, { name: e.detail || '' }),
        by: actorLabel(e.actor_name, locals.lang),
        ip: e.ip || '',
      })),
    },
  });
};
