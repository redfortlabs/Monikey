const KEY_EVENTS = new Set(['keydown','keypress','keyup','beforeinput','input']);
const PASTE_EVENTS = new Set(['paste']);

function escapeHtml(s){ if(!s) return ''; return String(s).replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }
function shortOrigin(s){
  if (!s) return '';
  try {
    if (s.startsWith('http')) {
      const u = new URL(s);
      const file = u.pathname.split('/').pop() || '';
      return u.host + (file ? '/' + file : '');
    }
    return s;
  } catch { return s; }
}
function baseDomain(host){
  if (!host) return '';
  const twoLevel = ['co.uk','org.uk','gov.uk','ac.uk','co.jp','com.au','com.br','com.ar','com.mx','com.cn','com.sg','com.tr','com.sa','com.ru','com.hk'];
  const parts = host.split('.').filter(Boolean);
  if (parts.length <= 2) return parts.join('.');
  const last2 = parts.slice(-2).join('.');
  if (twoLevel.includes(last2)) return parts.slice(-3).join('.');
  return last2;
}
function hostFromOrigin(origin){
  try {
    if (!origin) return '';
    if (origin.startsWith('http')) return new URL(origin).hostname || '';
    return ''; // blob:, extension:
  } catch { return ''; }
}
function looksExfil(preview){
  if (!preview) return false;
  const s = String(preview);
  const readsInput = /\.(value|innerText|textContent)\b/.test(s) || /event\.target\.value/.test(s) || /getElementById\([^)]*\)\.value/.test(s);
  const sendsNet  = /\bfetch\b|\bXMLHttpRequest\b|new\s+Image\s*\(|navigator\.sendBeacon|WebSocket\s*\(|\.send\s*\(/.test(s);
  return readsInput && sendsNet;
}

function computeRisk(report){
  const findings = [];
  const pageBD = baseDomain((report.pageHost) || (new URL(report.url||location.href)).hostname);

  // HIGH inline
  const inline = report.inlineHandlers || [];
  const inlineBad = inline.filter(h => KEY_EVENTS.has((h.type||'').toLowerCase()) || PASTE_EVENTS.has((h.type||'').toLowerCase()));
  if (inlineBad.length) {
    findings.push({
      level: 'HIGH',
      reason: 'Inline handlers for keystroke/paste events',
      items: inlineBad.slice(0,5).map(h => ({ selector: h.selector, type: h.type, preview: h.codePreview, origin: h.origin || '(inline-attr)', thirdParty: false, exfil: looksExfil(h.codePreview) }))
    });
    return findings;
  }

  // HIGH exfil previews
  const exfil = (report.addEventListener||[]).filter(r => looksExfil(r.codePreview)).slice(0,3)
    .map(r => ({ selector: r.selector, type: r.type, preview: r.codePreview, origin: r.origin || '', thirdParty: (function(){ const oh=baseDomain(hostFromOrigin(r.origin)); return !!oh && oh!==pageBD; })(), exfil: true }));
  if (exfil.length){
    findings.push({ level:'HIGH', reason:'Listener reads input and triggers network call (possible exfiltration)', items: exfil });
    return findings;
  }

  // MEDIUM: 3P global key/paste
  const add = report.addEventListener || [];
  for (const r of add) {
    const t = (r.type||'').toLowerCase();
    const sel = (r.selector||'').toLowerCase();
    const isGlobal = !sel || sel==='(unknown)' || sel==='body' || sel.startsWith('window') || sel.startsWith('document');
    if (!isGlobal) continue;
    if (!(KEY_EVENTS.has(t) || PASTE_EVENTS.has(t))) continue;
    const oh = baseDomain(hostFromOrigin(r.origin));
    const third = !!oh && oh !== pageBD;
    findings.push({ level:'MEDIUM', reason:`Global ${r.type} listener${third?' (third-party)':''}`, items:[{ selector:r.selector, type:r.type, preview:r.codePreview||'', origin:r.origin||'', thirdParty: third, exfil: looksExfil(r.codePreview) }] });
    // don't early return; collect a couple
    if (findings.length >= 1) break;
  }
  return findings;
}

function renderReport(r){
  const sum = document.getElementById('summary');
  const top = document.getElementById('top');
  const fEl = document.getElementById('riskflag');

  if (!r) {
    sum.textContent = 'No data yet.'; top.textContent=''; fEl.innerHTML=''; return;
  }

  sum.innerHTML =
    '<div><strong>URL:</strong> ' + escapeHtml(r.url) + '</div>' +
    '<div><strong>When:</strong> ' + escapeHtml(r.timestamp) + '</div>' +
    '<div><strong>addEventListener:</strong> ' + (r.totals.addEventListener||0) +
    ' &nbsp; | &nbsp; <strong>inline:</strong> ' + (r.totals.inlineHandlers||0) + '</div>';

  // Top listeners (include origin and [3P] tag)
  const map = new Map();
  (r.addEventListener || []).forEach(it => {
    const key = (it.selector||'(unknown)') + '|' + it.type + '|' + (it.origin||'');
    map.set(key, (map.get(key)||0)+1);
  });
  const topList = [...map.entries()].map(([k,c]) => {
    const [sel,t,origin] = k.split('|'); return {sel,t,c,origin};
  }).sort((a,b)=>b.c-a.c).slice(0,5);

  const pageBD = baseDomain((r.pageHost) || (new URL(r.url||location.href)).hostname);
  if (topList.length) {
    const items = topList.map(x => {
      const oh = baseDomain(hostFromOrigin(x.origin));
      const third = oh && oh !== pageBD;
      return '<li><code>'+escapeHtml(x.sel)+'</code> — '+escapeHtml(x.t)+' ('+x.c+')' +
             (x.origin ? ' <span class="muted">• '+escapeHtml(shortOrigin(x.origin))+(third?' [3P]':'')+'</span>' : '') +
             '</li>';
    }).join('');
    top.innerHTML = '<h4 style="margin:10px 0 4px">Top listeners</h4><ul>'+items+'</ul>';
  } else top.textContent = '';

  // Risk
  const findings = computeRisk(r);
  if (!findings || findings.length === 0) {
    fEl.innerHTML = '<div style="color:green;font-weight:600">No immediate risks detected</div>';
    return;
  }
  const highest = findings[0];
  const color = highest.level === 'HIGH' ? '#b71c1c' : '#f57f17';
  let html = '<div style="color:'+color+';font-weight:700">'+escapeHtml(highest.level)+' RISK: '+escapeHtml(highest.reason)+'</div>';
  if (highest.items && highest.items.length) {
    html += '<div style="font-size:12px;margin-top:6px">Details:</div><ul style="margin:6px 0 0 18px">';
    highest.items.forEach(it => {
      const oh = baseDomain(hostFromOrigin(it.origin));
      const third = it.thirdParty ?? (!!oh && oh !== pageBD);
      const tags = [
        third ? '[3P]' : null,
        looksExfil(it.preview) ? '[EXFIL?]' : null
      ].filter(Boolean).join(' ');
      html += '<li><code>'+escapeHtml(it.selector||'(unknown)')+'</code> — '+escapeHtml(it.type||'') +
              (it.origin ? ' <span class="muted">• '+escapeHtml(shortOrigin(it.origin))+'</span>' : '') +
              (tags ? ' <span class="muted">'+tags+'</span>' : '') +
              (it.preview ? ' <span style="color:#666">(' + escapeHtml(it.preview) + ')</span>' : '') +
              '</li>';
    });
    html += '</ul>';
  }
  fEl.innerHTML = html;
}

async function load() {
  const { monikey_last: r } = await chrome.storage.local.get('monikey_last');
  renderReport(r || null);
}
document.addEventListener('DOMContentLoaded', () => {
  load();
  // Copy button (kept from previous version if present)
  const btn = document.getElementById('copy');
  btn?.addEventListener('click', async () => {
    try {
      const { monikey_last } = await chrome.storage.local.get('monikey_last');
      if (!monikey_last) return;
      await navigator.clipboard.writeText(JSON.stringify(monikey_last, null, 2));
      const t = document.getElementById('toast');
      if (t) { t.style.display = 'inline'; setTimeout(()=>{ t.style.display='none'; }, 1200); }
    } catch (e) { console.error('Copy failed', e); }
  });
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.monikey_last) load();
});
