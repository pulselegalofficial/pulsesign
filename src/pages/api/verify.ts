import type { APIRoute } from 'astro';
import { findByHash } from '../../lib/docs';
import { json } from '../../lib/http';

/**
 * Public hash lookup. Returns only what someone holding the file can already
 * read on its certificate page, and nothing for unknown hashes.
 */
export const GET: APIRoute = async ({ url }) => {
  const hash = (url.searchParams.get('hash') || '').toLowerCase();
  const found = await findByHash(hash);
  if (!found) return json({ match: false });
  const { doc, signers } = found;
  return json({
    match: true,
    doc: { id: doc.id, title: doc.title, completedAt: doc.completed_at, signers: signers.map((s) => s.name) },
  });
};
