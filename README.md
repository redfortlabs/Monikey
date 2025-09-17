# MoniKey

**Monitor Keystrokes on the Web — proof-of-concept privacy lab tool**

This repo is a hobby lab project I built to explore and expose how webpages attach listeners to inputs and sometimes forward keystrokes offsite. It aims to be pragmatic and intentionally simple: Phase 1 proves the idea; Phase 2 makes it useful.  

This effort was inspired by the paper “Every Keystroke You Make: A Tech-Law Measurement and Analysis of Event Listeners for Wiretapping” by Shaoor Munir, Nurullah Demir, Qian Li, and Konrad Kollnig, and Zubair Shafiq.

## What is MoniKey?
MoniKey watches for input / keyboard-related event listeners on web pages and records when those listeners appear to capture or transmit keystrokes. It’s designed to help you see when a site is observing input activity beyond what you expect.

This is a learning / research tool, not a polished commercial product. Use it responsibly.

---

## Phase 1 (Proof of Concept) 
- Puppeteer + Chrome (headless).  
- Monkey-patches `addEventListener` to detect `keydown`, `keyup`, `keypress`, `input`.  
- Flags when listeners make outbound requests during typing.  
- Produces structured reports.  

Goal: prove we can reliably detect suspicious input listeners and save reproducible reports.  

---

## Phase 2 (MVP delivered) 
Already working today:  
- CLI options (`--url`, `--timeout`, etc.).  
- JSON reports with a pretty-print helper.  
- Early heuristics for suspicious behavior.  
- Batch/multi-URL scanning.  

This phase moved MoniKey from “proof-of-concept” to a usable MVP tool.  

---

## Phase 3 (Expansion) 
Planned next steps:  
- Cross-browser support (Firefox + Playwright).  
- Improved heuristics and scoring to reduce false positives.  
- HTML dashboard / visualization layer.  
- Expanded detection: clipboard/mouse events, content-script injections.  
- Packaged release for easy install and use.  

---

## Usage
1. Install [Node.js 18 or newer](https://nodejs.org/).  
2. Clone this repo and run:  
   ```bash
   npm ci
   npm run scan -- --url "https://example.com"
3. Reports are saved in ./reports/.

—-

## Roadmap
* Phase 1: Proof of concept (Puppeteer, reports).
* Phase 2: MVP delivered (CLI, JSON, heuristics).
* Phase 3: Expansion (cross-browser, scoring, dashboard, packaging).

—-

## License
MIT — do whatever you want, but don’t use this to invade others’ privacy.

—-

## Disclaimer 
MoniKey is for research and educational purposes only. Don’t use it to probe or monitor systems without explicit permission.

—-

## Contact
This is a hobby home-lab project. If you find a bug, want to contribute, or have a defensive use case, open an issue or PR. — Tyler (MoniKey author)
