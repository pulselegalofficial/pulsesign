// A stand-in for Google's OAuth endpoints, for local development only.
//
//   node scripts/fake-google.mjs        # listens on http://localhost:4400
//
// Point the app at it in .dev.vars (see .dev.vars.example). The sign-in page
// asks which email to "sign in" as; any address works, and the app then
// applies STAFF_EMAILS exactly as it does with real Google.
import { createServer } from 'node:http';

const PORT = Number(process.env.PORT || 4400);
const b64url = (s) => Buffer.from(s).toString('base64url');
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname === '/auth' && req.method === 'GET') {
    const p = url.searchParams;
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(`<!doctype html><meta name=viewport content="width=device-width"><title>Fake Google</title>
<body style="font-family:sans-serif;max-width:380px;margin:60px auto">
<h2>Fake Google sign-in</h2><p>Local development only.</p>
<form method="post" action="/auth">
<input type=hidden name=redirect_uri value="${esc(p.get('redirect_uri'))}"><input type=hidden name=state value="${esc(p.get('state'))}">
<label>Email<br><input name=email id=email value="pulse.legal.official@gmail.com" style="width:100%;padding:8px"></label>
<label style="display:block;margin:10px 0"><input type=checkbox name=unverified> email not verified</label>
<button id=continue style="padding:10px 16px">Continue</button></form>`);
    return;
  }
  const body = await new Promise((r) => {
    let d = '';
    req.on('data', (c) => (d += c));
    req.on('end', () => r(new URLSearchParams(d)));
  });
  if (url.pathname === '/auth' && req.method === 'POST') {
    const code = b64url(JSON.stringify({ email: body.get('email'), verified: !body.get('unverified') }));
    const back = new URL(body.get('redirect_uri'));
    back.searchParams.set('code', code);
    back.searchParams.set('state', body.get('state'));
    res.writeHead(303, { location: back.toString() });
    res.end();
    return;
  }
  if (url.pathname === '/token' && req.method === 'POST') {
    let who;
    try {
      who = JSON.parse(Buffer.from(body.get('code') || '', 'base64url').toString());
    } catch {
      res.writeHead(400).end('bad code');
      return;
    }
    const claims = {
      iss: 'https://accounts.google.com',
      aud: body.get('client_id'),
      exp: Math.floor(Date.now() / 1000) + 3600,
      email: who.email,
      email_verified: who.verified,
      name: who.email.split('@')[0],
    };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ id_token: `${b64url('{}')}.${b64url(JSON.stringify(claims))}.fake` }));
    return;
  }
  res.writeHead(404).end();
}).listen(PORT, () => console.log(`Fake Google on http://localhost:${PORT}`));
