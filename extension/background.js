console.log('[MoniKey bg] service worker starting');

function pageHook() {
  (function(){
    if (window.__monikey && window.__monikey.installed) return;

    var TARGET_EVENTS = ['keydown','keyup','keypress','input','beforeinput','change','submit','paste'];
    var recorded = [];
    var origAdd = EventTarget.prototype.addEventListener;

    function miniSelector(el){
      if (!el || !el.tagName) return '(unknown)';
      var id = el.id ? ('#' + el.id) : '';
      var cls = (typeof el.className === 'string' && el.className.trim())
        ? ('.' + el.className.trim().split(/\s+/).slice(0,2).join('.'))
        : '';
      return el.tagName.toLowerCase() + id + cls;
    }
    function safeToString(fn){ try { return (typeof fn === 'function') ? Function.prototype.toString.call(fn) : ''; } catch(_) { return ''; } }
    function getOriginFromStack() {
      try { throw new Error(); }
      catch (e) {
        var s = String(e.stack || '');
        var m = s.match(/(https?:\/\/[^\s)]+:\d+:\d+|blob:[^\s)]+|chrome-extension:\/\/[^\s)]+)/);
        return m ? m[1] : '';
      }
    }

    window.__monikey = window.__monikey || {};
    window.__monikey.installed = true;
    window.__monikey.recorded = recorded;
    window.__monikey.inline = [];
    window.__monikey._lastTotals = { add: -1, inline: -1 };
    window.__monikey._postedOnce = false;

    try {
      EventTarget.prototype.addEventListener = function(type, handler, opts){
        try {
          if (TARGET_EVENTS.indexOf(type) !== -1) {
            var el = this;
            var selector = '(unknown)';
            try {
              if (el && el.nodeType === 1) selector = miniSelector(el);
              else if (this === window) selector = 'window';
              else if (this === document || (el && el.nodeType === 9)) selector = 'document';
            } catch(_) {}
            recorded.push({
              type: String(type||''),
              selector: String(selector||'(unknown)'),
              ts: Date.now(),
              codePreview: safeToString(handler).slice(0,200),
              origin: getOriginFromStack()
            });
          }
        } catch(_) {}
        return origAdd.apply(this, arguments);
      };
    } catch(_) {}

    function scanInline(){
      try {
        var attrs = TARGET_EVENTS.map(function(e){ return 'on' + e; });
        var q = attrs.map(function(a){ return '[' + a + ']'; }).join(',');
        if (!q) { window.__monikey.inline = []; return; }
        var nodes = Array.prototype.slice.call(document.querySelectorAll(q));
        var out = [];
        for (var i=0;i<nodes.length;i++){
          var node = nodes[i];
          for (var j=0;j<attrs.length;j++){
            var a = attrs[j];
            if (node.hasAttribute(a)) {
              var code = node.getAttribute(a) || '';
              out.push({
                type: a.slice(2),
                selector: miniSelector(node),
                attr: a,
                codePreview: code.slice(0,200),
                origin: '(inline-attr)'
              });
            }
          }
        }
        window.__monikey.inline = out;
      } catch(_) {}
    }

    function makeReport(){
      return {
        url: String(location.href),
        pageHost: String(location.hostname || ''),
        timestamp: new Date().toISOString(),
        totals: { addEventListener: recorded.length, inlineHandlers: (window.__monikey.inline||[]).length },
        addEventListener: recorded.slice(),
        inlineHandlers: (window.__monikey.inline||[]).slice()
      };
    }

    function postReport(){ try { window.postMessage({ __monikey_event: 'REPORT', payload: makeReport() }, '*'); } catch(_) {} }

    function maybePost(){
      try{
        var add = recorded.length;
        var inline = (window.__monikey.inline||[]).length;
        var last = window.__monikey._lastTotals || { add:-1, inline:-1 };
        if (!window.__monikey._postedOnce) {
          window.__monikey._postedOnce = true;
          window.__monikey._lastTotals = { add, inline };
          postReport();
          return;
        }
        if (add > last.add || inline > last.inline) {
          window.__monikey._lastTotals = { add, inline };
          postReport();
        }
      } catch(_) {}
    }

    setTimeout(function(){ scanInline(); maybePost(); }, 1500);
    window.addEventListener('load', function(){ setTimeout(function(){ scanInline(); maybePost(); }, 1000); });
    setInterval(function(){ scanInline(); maybePost(); }, 8000);
  })();
}

// ---- Badge risk with 3P + exfil heuristics ----
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
    return ''; // blob:, extension: etc → treat as same-party neutral
  } catch { return ''; }
}
function looksExfil(preview){
  if (!preview) return false;
  const s = String(preview);
  const readsInput = /\.(value|innerText|textContent)\b/.test(s) || /event\.target\.value/.test(s) || /getElementById\([^)]*\)\.value/.test(s);
  const sendsNet  = /\bfetch\b|\bXMLHttpRequest\b|new\s+Image\s*\(|navigator\.sendBeacon|WebSocket\s*\(|\.send\s*\(/.test(s);
  return readsInput && sendsNet;
}
function isGlobalSelector(sel){
  const s = String(sel||'').toLowerCase();
  return !s || s === '(unknown)' || s === 'body' || s.startsWith('window') || s.startsWith('document');
}

function riskLevel(report){
  const keyish = new Set(['keydown','keypress','keyup','beforeinput','input','paste']);
  const pageBD = baseDomain((report.pageHost) || (new URL(report.url||location.href)).hostname);

  // HIGH: inline key/paste
  if ((report.inlineHandlers||[]).some(h => keyish.has(String(h.type||'').toLowerCase()))) return 'HIGH';

  // HIGH: any handler preview that looks like it reads input and sends network
  if ((report.addEventListener||[]).some(r => looksExfil(r.codePreview))) return 'HIGH';

  // MEDIUM: third-party global key/paste
  for (const r of (report.addEventListener||[])) {
    const t = String(r.type||'').toLowerCase();
    if (!keyish.has(t)) continue;
    const sel = r.selector || '';
    if (!isGlobalSelector(sel)) continue;
    const originHost = baseDomain(hostFromOrigin(r.origin));
    if (originHost && originHost !== pageBD) return 'MEDIUM';
  }
  return 'NONE';
}

function setBadge(level, tabId){
  const txt = level === 'HIGH' ? 'H' : level === 'MEDIUM' ? 'M' : '';
  const color = level === 'HIGH' ? '#b71c1c' : level === 'MEDIUM' ? '#f57f17' : '#00000000';
  chrome.action.setBadgeText({ tabId, text: txt });
  if (txt) chrome.action.setBadgeBackgroundColor({ tabId, color });
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg || msg.type !== 'MONIKEY_REPORT') return;
  const tabId = sender.tab && sender.tab.id;
  if (!tabId) return;
  const level = riskLevel(msg.report || {});
  setBadge(level, tabId);
});

chrome.tabs.onUpdated.addListener(function(tabId, changeInfo){
  if (changeInfo && (changeInfo.status === 'loading' || changeInfo.status === 'complete')) {
    chrome.action.setBadgeText({ tabId, text: '' });
    chrome.scripting.executeScript({
      target: { tabId },
      world: 'MAIN',
      func: pageHook
    }).catch(function(){});
  }
});
