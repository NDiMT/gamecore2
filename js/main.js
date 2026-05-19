// Entry point: wire Game + Net + UI together.
(function () {
  'use strict';

  const game = new window.Game();
  const net = new window.Net(game);
  const ui = new window.UI(game, net);

  // Host broadcasts state through Net.
  game.broadcastFn = (msg) => net.broadcast(msg);

  // Re-render on every state change.
  game.subscribe(() => ui.render());

  // Status toasts.
  net.onStatus = (status) => {
    if (status === 'connected') window.U.toast('Connected!');
    else if (status === 'disconnected') window.U.toast('Disconnected.');
  };

  // Expose for the renderer (it queries net.mode for control checks) and
  // for debugging from a remote inspector on mobile.
  window.NET = net;
  window.GAME = game;
  window.UI_ = ui;

  // Keep the canvas crisp on viewport changes.
  window.addEventListener('resize', () => {
    if (ui.renderer) ui.renderer.resize();
  });

  // First paint.
  ui.render();
})();
