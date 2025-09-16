// content.js — relay page -> extension storage AND background (for badge)
window.addEventListener('message', function (ev) {
  if (!ev.data || ev.source !== window) return;
  if (ev.data.__monikey_event !== 'REPORT') return;
  const report = ev.data.payload;
  try {
    chrome.storage && chrome.storage.local && chrome.storage.local.set({ monikey_last: report });
  } catch (_) {}
  try {
    chrome.runtime && chrome.runtime.sendMessage({ type: 'MONIKEY_REPORT', report });
  } catch (_) {}
}, false);
