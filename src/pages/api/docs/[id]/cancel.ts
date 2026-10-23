import type { APIRoute } from 'astro';
import { DocError, cancelDoc, getDoc } from '../../../../lib/docs';
import { clientInfo, fail, json, notFound, unauthorized } from '../../../../lib/http';
import { displayName } from '../../../../lib/auth';

export const POST: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;
  if (!user) return unauthorized();
  const doc = await getDoc(params.id!);
  if (!doc) return notFound();
  try {
    const { ip, ua } = clientInfo(request);
    await cancelDoc(doc, { name: displayName(user), email: user.email, ip, ua });
    return json({ ok: true });
  } catch (e) {
    if (e instanceof DocError) return fail(e.code, e.status);
    throw e;
  }
};
