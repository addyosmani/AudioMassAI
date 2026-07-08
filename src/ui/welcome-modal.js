/**
 * Welcome dialog shown on startup (and reachable from the Help menu).
 */

import { SimpleModal } from './modals.js';

const AUTO_SHOW_DELAY_MS = 320;

// Percentage chance to *skip* the dialog on startup once it has been seen.
let skipPercentage = 96;

/** Show the welcome/tips dialog. */
export function showWelcomeModal(app) {
  let tipsHtml = '';
  let githubHtml = '';

  if (app.isMobile) {
    skipPercentage -= 15;
    tipsHtml =
      'Tips:<br/>Please make sure your device is not in silent mode. You might need to physically flip the silent switch. ' +
      '<img src="/images/phone-switch.jpg" style="max-width:224px;max-height:126px;width:40%;margin: 10px auto; display: block;"/>' +
      '<br/><br/>';
  } else {
    tipsHtml =
      'Tips:<br/>Please keep in mind that most key shortcuts rely on the <strong>Shift + <u>key</u></strong> combo. (eg Shift+Z for undo, Shift+C copy, Shift+X cut... etc )<br/><br/>';
    githubHtml =
      'Check out the codebase on <a href="https://github.com/pkalogiros/audiomass" target="_blank">Github</a><br/><br/>';
  }

  const modal = new SimpleModal({
    title: '<font style="font-size:15px">Welcome to AudioMass</font>',
    ondestroy: function () {
      app.ui.InteractionHandler.on = false;
      app.ui.KeyHandler.removeCallback('modalTemp');
    },
    body:
      '<div style="overflow:auto;-webkit-overflow-scrolling:touch;max-width:580px;width:calc(100vw - 40px);max-height:calc(100vh - 340px);min-height:110px;font-size:13px; color:#95c6c6;padding-top:7px;">' +
      'AudioMass is a free, open source, web-based Audio and Waveform Editor.<br />It runs entirely in the browser with no backend and no plugins required!' +
      '<br/><br/><br/>' +
      tipsHtml +
      'You can load any type of audio your browser supports and perform operations such as fade in, cut, trim, change the volume, ' +
      'and apply a plethora of audio effects.<br/><br/>' +
      githubHtml +
      '</div>',
    setup: function (modalInstance) {
      app.ui.InteractionHandler.checkAndSet('modal');
      app.ui.KeyHandler.addCallback(
        'modalTemp',
        function () {
          modalInstance.Destroy();
        },
        [27]
      );

      // Let the tips body scroll on touch devices without moving the waveform.
      const scrollArea = modalInstance.el_body.getElementsByTagName('div')[0];
      scrollArea.addEventListener('touchstart', (event) => event.stopPropagation(), false);
      scrollArea.addEventListener('touchmove', (event) => event.stopPropagation(), false);
    },
  });

  modal.Show();
  document.getElementsByClassName('pk_modal_cancel')[0].innerHTML =
    '&nbsp; &nbsp; &nbsp; OK &nbsp; &nbsp; &nbsp;';
}

/**
 * Show the welcome dialog shortly after startup — always on the very first
 * visit, and with a small random chance on subsequent visits.
 */
export function scheduleWelcomeModal(app) {
  setTimeout(() => {
    const seenBefore = window.localStorage && window.localStorage.getItem('k');

    let skipChance = skipPercentage;
    if (!seenBefore) {
      skipChance = 0;
      window.localStorage && window.localStorage.setItem('k', 1);
    }

    if ((Math.random() * 100) >> 0 < skipChance) return;
    showWelcomeModal(app);
  }, AUTO_SHOW_DELAY_MS);
}
