import type { APIRoute } from 'astro';
import { findByHash, getEvents } from '../../lib/docs';
import { describeUserAgent } from '../../lib/format';
import { actorLabel, dict, fill } from '../../lib/i18n';
import { json } from '../../lib/http';

/**
 * Public hash lookup. Only someone holding the exact signed file can produce
 * its hash, so a match returns the evidence that is not printed on the
 * certificate: each signer's device and the full audit trail.
 * Unknown hashes get nothing. Emails are not returned.
 *
 * IP addresses are personal data and signed files get forwarded, so they are
 * returned only to signed-in staff. Everyone else gets the rest of the
 * evidence; the full record stays in the database for disputes.
 */
export const GET: APIRoute = async ({ url, locals }) => {
  const staff = Boolean(locals.user);
  const hash = (url.searchParams.get('hash') || '').toLowerCase();
  const found = await findByHash(hash);
  if (!found) return json({ match: false });
  const { doc, signers } = found;
  const t = dict(locals.lang) as unknown as Record<string, string>;
  const events = await getEvents(doc.id);
  return json({
    match: true,
    doc: {
      staff,
      id: doc.id,
      title: doc.title,
      completedAt: doc.completed_at,
      signers: signers.map((s) => ({
        name: s.name,
        signedAt: s.signed_at,
        ip: staff ? s.ip || '' : '',
        device: describeUserAgent(s.user_agent),
      })),
      events: events.map((e) => ({
        at: e.at,
        label: fill(t[`ev_${e.type}`] || e.type, { name: e.detail || '' }),
        by: actorLabel(e.actor_name, locals.lang),
        ip: staff ? e.ip || '' : '',
      })),
    },
  });
};
