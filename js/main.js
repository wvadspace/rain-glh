/* Bootstrap: restore a save if there is one, otherwise open the new-game panel. */
var AutoShop = globalThis.AutoShop || (globalThis.AutoShop = {});

(function (NS) {
  'use strict';

  function start() {
    var saved = NS.State.load();
    var state = saved || NS.State.newGame({ difficulty: 'normal' });
    NS.UI.boot(state);
    if (!saved) {
      NS.UI.showNewGame();
    } else {
      NS.UI.toast('Loaded your shop at day ' + state.day + '.');
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})(AutoShop);
