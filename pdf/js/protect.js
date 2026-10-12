// Protect menu: password-encrypt (applied when saving), remove security, security properties,
// unlock restricted documents with the owner password, and the password prompt used on open.
import { App, emit } from './state.js';
import { decryptPdf, newSecurity, encryptPdf, checkOwnerPassword, PasswordError, UnsupportedSecurity, PERM_LABEL, describe, inspect } from './security.js';
import { esc } from './util.js';

function askPassword(name, again) {
  return new Promise(res => Aero.dialog({
    title: again ? 'Incorrect password' : 'Password required', width: 440,
    instruction: again ? `That password didn't work. Enter the password for “${name}”:` : `“${name}” is protected. Enter the password to open it:`,
    fields: [{ key: 'pw', label: 'Password', type: 'password', value: '' }], ok: 'Open',
    onOK: v => res(v.pw ?? ''), onCancel: () => res(null)
  }));
}
// -> {bytes, security} | null (cancelled) | {fallback:true}
export async function unlockForOpen(bytes, name, { password = null } = {}) {
  if (!(await inspect(bytes))) return { bytes, security: null };
  let pw = password ?? '', tries = 0;
  for (;;) {
    try { Aero.busy('Decrypting…'); const r = await decryptPdf(bytes, pw); return r; }
    catch (e) {
      Aero.busy();
      if (e instanceof PasswordError) { const p = await askPassword(name, tries++ > 0 || password != null); if (p == null) return null; pw = p; continue; }
      if (e instanceof UnsupportedSecurity) { Aero.toast(e.message, 5000); return { fallback: true }; }
      console.warn('decrypt', e); return { fallback: true };
    } finally { Aero.busy(); }
  }
}
export async function secureOutput(d, bytes) { return d.state.security ? encryptPdf(bytes, d.state.security) : bytes; }

export function protectDialog() {
  const d = App.doc; if (!d) return;
  if (d.readOnly) { Aero.alert('Encrypt with password', 'This document is read-only. Unlock it first.'); return; }
  const permKeys = ['print', 'printHigh', 'modify', 'assemble', 'fill', 'annotate', 'copy', 'accessibility'];
  const fields = [
    { key: 'method', label: 'Encryption', type: 'select', value: 'AES-256', options: [['AES-256', 'AES 256-bit (Acrobat X and later)'], ['AES-128', 'AES 128-bit (Acrobat 7 and later)']] },
    { key: 'user', label: 'Password to open (optional)', type: 'password', value: '' }, { key: 'user2', label: 'Confirm', type: 'password', value: '' },
    { key: 'owner', label: 'Permissions password', type: 'password', value: '' }, { key: 'owner2', label: 'Confirm', type: 'password', value: '' },
    ...permKeys.map(k => ({ key: 'p_' + k, label: 'Allow ' + PERM_LABEL[k].toLowerCase(), type: 'checkbox', value: true }))
  ];
  Aero.dialog({
    title: 'Encrypt with password', width: 520, instruction: 'Protect this PDF with passwords and permissions', fields, ok: 'Apply',
    html: `<div class="dnote">The password to open is needed to view the document. The permissions password lets you (or others) change the restrictions later — required when you restrict anything. Protection is applied every time you save. Permissions are honoured by compliant PDF readers.</div>`,
    onOK: async v => {
      if (v.user !== v.user2) return Aero.alert('Encrypt with password', 'The passwords to open don’t match.');
      if (v.owner !== v.owner2) return Aero.alert('Encrypt with password', 'The permissions passwords don’t match.');
      const perms = Object.fromEntries(permKeys.map(k => [k, !!v['p_' + k]]));
      const restricted = Object.values(perms).some(x => !x);
      if (!v.user && !restricted) return Aero.alert('Encrypt with password', 'Set a password to open, or restrict at least one permission.');
      if (restricted && !v.owner) return Aero.alert('Encrypt with password', 'Restricting permissions needs a permissions password.');
      if (restricted && v.owner === v.user) return Aero.alert('Encrypt with password', 'The permissions password must be different from the password to open.');
      return applyProtection({ method: v.method, userPassword: v.user, ownerPassword: v.owner, perms });
    }
  });
}
export async function applyProtection(opts) {
  const d = App.doc; Aero.busy('Preparing encryption…');
  try { d.state.security = await newSecurity(opts); } finally { Aero.busy(); }
  d.commit('Encrypt with password'); emit('props');
  Aero.toast(`Protection set (${describe(d.state.security)}) — it is applied when you save`, 4500);
  return d.state.security;
}
export async function removeSecurity() {
  const d = App.doc; if (!d) return;
  if (!d.state.security) { Aero.alert('Remove security', 'This document is not password protected.'); return; }
  if (!d.state.security.owner && d.state.security.mode === 'keep') {
    const ok = await unlockOwner(true); if (!ok) return;
  }
  d.state.security = null; d.commit('Remove security'); emit('props');
  Aero.toast('Security removed — save to write an unprotected copy');
}
export async function unlockOwner(quiet) {
  const d = App.doc; const sec = d?.state.security; if (!sec) return true;
  if (sec.owner) return true;
  const pw = await new Promise(res => Aero.dialog({ title: 'Permissions password', width: 440, instruction: 'Enter the permissions (owner) password to change this document’s security or edit it:', fields: [{ key: 'pw', label: 'Password', type: 'password', value: '' }], onOK: v => res(v.pw || ''), onCancel: () => res(null) }));
  if (pw == null) return false;
  if (!(await checkOwnerPassword(sec, pw))) { Aero.alert('Permissions password', 'That is not the permissions password.'); return false; }
  d.state.security = { ...sec, owner: true }; d.hist.items.forEach(it => { if (it.state.security === sec) it.state.security = d.state.security; });
  if (d.readOnly === 'restricted') { d.readOnly = false; emit('docChanged'); }
  if (!quiet) Aero.toast('Unlocked — you can now edit the document and change its security');
  return true;
}
export function securityProperties() {
  const d = App.doc; if (!d) return; const s = d.state.security;
  const rows = s ? Object.entries(PERM_LABEL).map(([k, l]) => `<b>${esc(l)}</b><span>${s.perms[k] ? 'Allowed' : 'Not allowed'}</span>`).join('') : '';
  Aero.dialog({
    title: 'Security properties', noCancel: true, width: 480,
    html: s ? `<div class="kbd"><b>Encryption</b><span>${esc(s.method)}</span><b>Password to open</b><span>${s.hasUserPassword ? 'Yes' : 'No'}</span><b>Your access</b><span>${s.owner ? 'Full (owner)' : 'Restricted (user password)'}</span><h4>Permissions</h4>${rows}</div>${s.mode === 'new' ? '<div class="dnote">New protection — it is applied when you save.</div>' : ''}`
      : '<div class="dnote" style="color:#333">This document has no security. Use <b>File › Protect › Encrypt with Password…</b> to add a password and permissions.</div>'
  });
}
