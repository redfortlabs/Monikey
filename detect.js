// detect.js
const puppeteer = require('puppeteer');

const TARGET_EVENTS = [
  'keydown','keyup','keypress','input','change','beforeinput','submit','paste'
];

function miniSelector(el){
  if(!el || !el.tagName) return '(unknown)';
  const id = el.id ? `#${el.id}` : '';
  const cls = el.className && typeof el.className === 'string'
    ? '.' + el.className.trim().split(/\s+/).slice(0,2).join('.')
    : '';
  return `${el.tagName.toLowerCase()}${id}${cls}`;
}

(async () => {
  const url = process.argv[2] || 'https://example.com';

  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  // Record addEventListener calls early (before any page JS runs)
  await page.evaluateOnNewDocument((TARGET_EVENTS) => {
    const recorded = [];
    const origAdd = EventTarget.prototype.addEventListener;

    // expose a hook to read results later
    // eslint-disable-next-line no-undef
    window.__monikey = { recorded, inline: [] };

    EventTarget.prototype.addEventListener = function(type, handler, opts){
      try{
        if(TARGET_EVENTS.includes(type)){
          const el = this;
          let where = 'window';
          if (el && el.nodeType === 1) where = (el.tagName || 'elem');
          // Attempt a rough selector
          let selector = '(unknown)';
          try{
            if (el && el.nodeType === 1) {
              selector = el.tagName.toLowerCase();
              if (el.id) selector += `#${el.id}`;
              if (el.classList && el.classList.length) {
                selector += '.' + Array.from(el.classList).slice(0,2).join('.');
              }
            }
          }catch(e){}

          recorded.push({
            type,
            target: where,
            selector,
            options: typeof opts === 'object' ? { passive: !!opts.passive, capture: !!opts.capture, once: !!opts.once } : {},
            ts: Date.now()
          });
        }
      }catch(e){}
      return origAdd.apply(this, arguments);
    };
  }, TARGET_EVENTS);

  await page.goto(url, { waitUntil: ['domcontentloaded','networkidle2'], timeout: 60000 });

  // Also catch inline handlers like onkeydown=...
  const inline = await page.evaluate((TARGET_EVENTS, miniSelectorSource) => {
    // recreate miniSelector in page context
    // WARNING: keep in sync with Node version
    function miniSelector(el){
      if(!el || !el.tagName) return '(unknown)';
      const id = el.id ? `#${el.id}` : '';
      const cls = el.className && typeof el.className === 'string'
        ? '.' + el.className.trim().split(/\s+/).slice(0,2).join('.')
        : '';
      return `${el.tagName.toLowerCase()}${id}${cls}`;
    }

    const attrs = TARGET_EVENTS.map(e => 'on'+e);
    const nodes = Array.from(document.querySelectorAll(attrs.map(a=>`[${a}]`).join(',')));
    return nodes.flatMap(node => {
      return attrs
        .filter(a => node.hasAttribute(a))
        .map(a => ({
          type: a.slice(2),
          selector: miniSelector(node),
          attr: a,
          codePreview: (node.getAttribute(a) || '').slice(0,100)
        }));
    });
  }, TARGET_EVENTS, miniSelector.toString());

  // Pull the recorded addEventListener calls
  const recorded = await page.evaluate(() => (window.__monikey?.recorded || []));
  await page.close();
  await browser.close();

  const report = {
    url,
    timestamp: new Date().toISOString(),
    totals: {
      addEventListener: recorded.length,
      inlineHandlers: inline.length
    },
    addEventListener: recorded,
    inlineHandlers: inline
  };

  console.log(JSON.stringify(report, null, 2));
})();

