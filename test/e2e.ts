// End-to-end check against a running CSS with css-invites.
// Usage: bun test/e2e.ts <base url> <seed code>
// Expects INVITES_ADMIN_WEBIDS to include <base>admin/profile/card#me and the seed code to be unused.
const [ base, seed ] = process.argv.slice(2);
if (!base || !seed) {
  console.error('usage: bun test/e2e.ts <base url> <seed code>');
  process.exit(2);
}

let failures = 0;
function check(name: string, ok: boolean, detail = ''): void {
  if (!ok) {
    failures += 1;
  }
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}

const json = { 'content-type': 'application/json', accept: 'application/json' };
async function post(url: string, body: unknown, token?: string): Promise<{ status: number; body: any }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { ...json, ...token ? { authorization: `CSS-Account-Token ${token}` } : {}},
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch((): undefined => undefined) };
}
async function get(url: string, token?: string): Promise<{ status: number; body: any }> {
  const res = await fetch(url, { headers: { accept: 'application/json', ...token ? { authorization: `CSS-Account-Token ${token}` } : {}}});
  return { status: res.status, body: await res.json().catch((): undefined => undefined) };
}

const createUrl = `${base}.account/account/`;
const invitesUrl = `${base}.account/invites/`;

/** Creates an account with the given code, plus a password login and a pod. Returns its token. */
async function signUp(code: string, name: string): Promise<string> {
  const created = await post(createUrl, { inviteCode: code });
  if (created.status !== 200) {
    throw new Error(`sign-up with ${code} -> ${created.status} ${created.body?.message}`);
  }
  const token = created.body.authorization as string;
  const { body: { controls }} = await get(`${base}.account/`, token);
  const pw = await post(controls.password.create, { email: `${name}@example.invalid`, password: `${name}-password-1` }, token);
  const pod = await post(controls.account.pod, { name }, token);
  if (pw.status !== 200 || pod.status !== 200) {
    throw new Error(`setting up ${name}: password ${pw.status}, pod ${pod.status} ${pod.body?.message}`);
  }
  return token;
}

const noCode = await post(createUrl, {});
check('sign-up without a code is refused', noCode.status === 400, `${noCode.status} ${noCode.body?.message}`);

const noBodyRes = await fetch(createUrl, { method: 'POST' });
check('sign-up with no body (the stock register page) is refused', noBodyRes.status === 400, String(noBodyRes.status));

const badCode = await post(createUrl, { inviteCode: 'NOPE-NOPE-NOPE-NOPE' });
check('sign-up with an unknown code is refused', badCode.status === 403, `${badCode.status} ${badCode.body?.message}`);

const admin = await signUp(seed.toLowerCase().replace(/-/gu, ' '), 'admin');
check('seed code works (case and separators ignored)', Boolean(admin));

const reuse = await post(createUrl, { inviteCode: seed });
check('a used code is refused', reuse.status === 403, reuse.body?.message);

const anon = await get(invitesUrl);
check('invite admin API needs a login', anon.status === 401, String(anon.status));

const list = await get(invitesUrl, admin);
check('admin can list invites', list.status === 200 && Array.isArray(list.body?.invites), String(list.status));
check('the seed invite shows as used', list.body?.invites?.some((i: any): boolean => i.usesLeft === 0 && i.usedBy.length === 1));

const minted = await post(invitesUrl, { note: 'friend', uses: '1', expiresInDays: '7' }, admin);
check('admin can create an invite', minted.status === 200 && /^[A-Z2-9]{4}(-[A-Z2-9]{4}){3}$/u.test(minted.body?.code ?? ''), minted.body?.code);
check('invite link points at the sign-up page', String(minted.body?.link).startsWith(`${base}.account/login/password/register/?invite=`), minted.body?.link);

const friend = await signUp(minted.body.code, 'friend');
const friendList = await get(invitesUrl, friend);
check('a non-admin account cannot manage invites', friendList.status === 403, String(friendList.status));

const toRevoke = await post(invitesUrl, { note: 'revoke me' }, admin);
const revoked = await post(invitesUrl, { revoke: toRevoke.body.invite.id }, admin);
check('admin can revoke an invite', revoked.status === 200, String(revoked.status));
const useRevoked = await post(createUrl, { inviteCode: toRevoke.body.code });
check('a revoked code is refused', useRevoked.status === 403, useRevoked.body?.message);

const shortLived = await post(invitesUrl, { expiresInDays: 0.00001 }, admin);
await Bun.sleep(1500);
const useExpired = await post(createUrl, { inviteCode: shortLived.body.code });
check('an expired code is refused', useExpired.status === 403, useExpired.body?.message);

const multi = await post(invitesUrl, { uses: 2 }, admin);
const racers = await Promise.all([ 1, 2, 3 ].map(async(): Promise<number> => (await post(createUrl, { inviteCode: multi.body.code })).status));
check('a 2-use code admits exactly 2 of 3 simultaneous sign-ups', racers.filter((s): boolean => s === 200).length === 2, racers.join(','));

const page = await fetch(`${base}.account/login/password/register/`, { headers: { accept: 'text/html' }});
check('sign-up page has the invite code field', page.status === 200 && (await page.text()).includes('id="inviteCode"'));

const html = (token?: string): Promise<Response> => fetch(invitesUrl, {
  redirect: 'manual',
  headers: { accept: 'text/html', ...token ? { authorization: `CSS-Account-Token ${token}` } : {}},
});
const invitesPage = await html(admin);
check('invites page renders for an admin', invitesPage.status === 200 && (await invitesPage.text()).includes('Create invite'));
const anonPage = await html();
check('invites page redirects a visitor who is not logged in to the login page',
  anonPage.status === 302 && anonPage.headers.get('location') === `${base}.account/login/password/`,
  `${anonPage.status} ${anonPage.headers.get('location')}`);
const friendPage = await html(friend);
const friendBody = await friendPage.text();
check('invites page is a 404 for a non-admin account', friendPage.status === 404 && !friendBody.includes('Create invite'), String(friendPage.status));
const otherPage = await fetch(`${base}.account/login/password/`, { headers: { accept: 'text/html' }});
check('other HTML pages still render', otherPage.status === 200, String(otherPage.status));

console.log(failures === 0 ? '\nAll checks passed.' : `\n${failures} check(s) failed.`);
process.exit(failures === 0 ? 0 : 1);
