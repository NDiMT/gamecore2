// Entry point: wire Game + Net + UI together.
(function () {
  'use strict';

  const game = new window.Game();
  const net = new window.Net(game);
  const ui = new window.UI(game, net);

  // Host broadcasts state through Net.
  game.broadcastFn = (msg) => net.broadcast(msg);

  // Any state change triggers a re-render.
  game.subscribe(() => ui.render());

  // Network status toasts for the user.
  net.onStatus = (status) => {
    if (status === 'connected') window.U.toast('Συνδέθηκε!');
    else if (status === 'disconnected') window.U.toast('Αποσυνδέθηκε.');
  };

  // First paint.
  ui.render();

  // Expose for debugging in mobile remote-inspect.
  window.GAME = game;
  window.NET = net;
  window.UI_ = ui;
})();
