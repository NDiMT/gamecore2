// Entry point: wire Game + Net + UI together.
(function () {
  'use strict';

  function showFatal(msg) {
    const root = document.getElementById('app');
    if (!root) return;
    root.innerHTML = '';
    const box = document.createElement('div');
    box.style.cssText = 'margin: 20px; padding: 16px; border: 2px solid #c43b3b; border-radius: 10px; background: rgba(50,15,15,0.6); color: #ffd0d0;';
    const h = document.createElement('h3');
    h.textContent = 'Failed to load';
    h.style.cssText = 'margin: 0 0 8px; color: #f4a0a0;';
    const p = document.createElement('p');
    p.textContent = msg;
    p.style.cssText = 'margin: 0 0 12px; font-size: 13px;';
    const btn = document.createElement('button');
    btn.textContent = '↻ Reload';
    btn.style.cssText = 'padding: 10px 16px; background: #6e4d9e; color: white; border: none; border-radius: 8px; font-size: 14px; cursor: pointer;';
    btn.onclick = () => window.location.reload();
    box.appendChild(h); box.appendChild(p); box.appendChild(btn);
    root.appendChild(box);
  }

  try {
    if (typeof window.THREE === 'undefined') {
      showFatal('Three.js failed to load. Check your network connection and reload.');
      return;
    }
    if (typeof window.Peer === 'undefined') {
      showFatal('PeerJS failed to load. Check your network connection and reload.');
      return;
    }

    const game = new window.Game();
    const net = new window.Net(game);
    const ui = new window.UI(game, net);

    game.broadcastFn = (msg) => net.broadcast(msg);
    game.subscribe(() => ui.render());

    net.onStatus = (status) => {
      if (status === 'connected') window.U.toast('Connected!');
      else if (status === 'disconnected') window.U.toast('Disconnected.');
    };

    window.NET = net;
    window.GAME = game;
    window.UI_ = ui;

    window.addEventListener('resize', () => {
      if (ui.renderer) ui.renderer.resize();
    });

    ui.render();
  } catch (e) {
    console.error(e);
    showFatal('Boot error: ' + (e && e.message ? e.message : e));
  }
})();
