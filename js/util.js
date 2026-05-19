// Shared helpers exposed on `window` so all script files can use them.
(function () {
  'use strict';

  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      for (const k in props) {
        if (k === 'class') node.className = props[k];
        else if (k === 'text') node.textContent = props[k];
        else if (k === 'html') node.innerHTML = props[k];
        else if (k === 'style') Object.assign(node.style, props[k]);
        else if (k.startsWith('on') && typeof props[k] === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), props[k]);
        } else if (k === 'attrs') {
          for (const ak in props.attrs) node.setAttribute(ak, props.attrs[ak]);
        } else if (props[k] !== false && props[k] != null) {
          node[k] = props[k];
        }
      }
    }
    if (children) {
      for (const c of [].concat(children)) {
        if (c == null || c === false) continue;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      }
    }
    return node;
  }

  function rand(n) { return Math.floor(Math.random() * n); }
  function pick(arr) { return arr[rand(arr.length)]; }
  function rollDie() { return 1 + rand(6); }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = rand(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function deepClone(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function toast(msg, ms) {
    const tw = document.getElementById('toast');
    const t = el('div', { class: 'toast-msg', text: msg });
    tw.appendChild(t);
    setTimeout(() => t.remove(), ms || 2500);
  }

  // Wait for ICE gathering completion so the local description includes all
  // candidates baked into the SDP (works for manual copy/paste signaling).
  function waitIceComplete(pc) {
    return new Promise(resolve => {
      if (pc.iceGatheringState === 'complete') return resolve();
      const onChange = () => {
        if (pc.iceGatheringState === 'complete') {
          pc.removeEventListener('icegatheringstatechange', onChange);
          resolve();
        }
      };
      pc.addEventListener('icegatheringstatechange', onChange);
      // Safety cap so a stuck gatherer doesn't block forever.
      setTimeout(() => resolve(), 4000);
    });
  }

  // Compact SDP <-> short string. Just base64 of JSON; trimmed for brevity.
  function encodeSignal(obj) {
    const json = JSON.stringify(obj);
    return btoa(unescape(encodeURIComponent(json)));
  }
  function decodeSignal(str) {
    try { return JSON.parse(decodeURIComponent(escape(atob(str.trim())))); }
    catch (e) { return null; }
  }

  async function copyToClipboard(text) {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
        return true;
      }
    } catch (e) { /* fallthrough */ }
    // Fallback for older mobile browsers.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) {}
    ta.remove();
    return ok;
  }

  window.U = { el, rand, pick, rollDie, clamp, shuffle, deepClone, toast, waitIceComplete, encodeSignal, decodeSignal, copyToClipboard };
})();
