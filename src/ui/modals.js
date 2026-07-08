/**
 * Modal dialogs.
 *
 * - `SimpleModal`: a generic modal with title, body, toolbar and bottom buttons.
 * - `AudioEffectModal`: a factory wrapping SimpleModal with the effect-preview
 *   plumbing shared by all FX dialogs (ON/OFF + Preview toolbar, preset
 *   dropdown management, preview event wiring).
 *
 * Instance properties such as `el_body`, `el_title`, `els.bottom` and the
 * `Show()` / `Destroy()` methods are relied upon across the app; treat them
 * as the public API of this module.
 */

let nextModalId = 0;

export class SimpleModal {
  constructor(config) {
    const modal = this;

    this.id = config.id ? config.id : ++nextModalId;

    const root = document.createElement('div');
    this.els = {
      toolbar: [],
      bottom: [],
    };
    root.className = 'pk_modal ' + (config.clss ? config.clss : '');
    this.el = root;

    // Backdrop that dims the rest of the page.
    const backdrop = document.createElement('div');
    backdrop.className = 'pk_modal_back';
    this.el_back = backdrop;

    // Wrapper used to center the modal.
    const centerer = document.createElement('div');
    centerer.className = 'pk_modal_cnt';
    this.el_cont = centerer;

    // Title bar.
    const titleBar = document.createElement('div');
    titleBar.className = 'pk_noselect pk_modal_title';
    titleBar.innerHTML = '<span>' + (config.title || '') + '</span>';
    root.appendChild(titleBar);
    this.el_title = titleBar;

    // Main body.
    const body = document.createElement('div');
    body.className = 'pk_modal_main';
    root.appendChild(body);
    this.el_body = body;

    // Bottom button row — always starts with CANCEL.
    const bottomBar = document.createElement('div');
    bottomBar.className = 'pk_noselect pk_modal_bottom';

    const cancelButton = document.createElement('a');
    cancelButton.innerHTML = 'CANCEL';
    cancelButton.className = 'pk_modal_cancel pk_modal_a_bottom';
    cancelButton.onclick = function () {
      modal.Destroy();
    };
    bottomBar.appendChild(cancelButton);

    if (config.buttons && config.buttons.length > 0) {
      for (const buttonConfig of config.buttons) {
        if (!buttonConfig.title || !buttonConfig.callback) continue;

        const button = document.createElement('a');
        button.innerHTML = buttonConfig.title;
        button.className = 'pk_modal_a_bottom ' + (buttonConfig.clss ? buttonConfig.clss : '');
        button.onclick = () => buttonConfig.callback(modal);

        this.els.bottom.push(button);
        bottomBar.appendChild(button);
      }
    }
    root.appendChild(bottomBar);

    // Optional toolbar links inside the title bar (e.g. ON/OFF, Preview).
    if (config.toolbar && config.toolbar.length > 0) {
      for (const toolConfig of config.toolbar) {
        if (!toolConfig.title || !toolConfig.callback) continue;

        const link = document.createElement('a');
        link.innerHTML = toolConfig.title;
        link.className = 'pk_modal_a_top ' + (toolConfig.clss ? toolConfig.clss : '');
        titleBar.appendChild(link);

        link.onclick = function () {
          toolConfig.callback(modal, this);
        };
        this.els.toolbar.push(link);
      }
    }

    this.ondestroy = config.ondestroy;
    if (config.body) this.el_body.innerHTML = config.body;
    if (config.onpreset) this.onpreset = config.onpreset;
    if (config.setup) config.setup(this);
  }

  Show() {
    this.el_back.appendChild(this.el_cont);
    this.el_cont.appendChild(this.el);

    document.body.appendChild(this.el_back);

    return this;
  }

  Destroy() {
    if (this.ondestroy) {
      this.ondestroy(this);
      this.ondestroy = null;
    }
    this.els = null;
    document.body.removeChild(this.el_back);
  }
}

/**
 * Build a SimpleModal specialized for audio effects: adds the ON/Preview
 * toolbar, keeps the preset <select> in sync, and cleans up all preview
 * event listeners when the dialog closes.
 *
 * @param {object} config  SimpleModal config plus `preview`, `presets`,
 *                         `custom_pres` and `updateFilter` extensions.
 * @param {object} app     The AudioEditor instance (event bus + ui).
 * @returns {SimpleModal}
 */
export function AudioEffectModal(config, app) {
  let toolbar = null;

  if (config.preview) {
    toolbar = [
      {
        title: 'ON',
        clss: 'pk_inact',
        callback: function () {
          app.fireEvent('RequestActionFX_TOGGLE');
        },
      },
      {
        title: 'Preview',
        callback: function (modal) {
          config.preview && config.preview(modal);
        },
      },
    ];
  }

  const effectModal = new SimpleModal({
    id: config.id,
    title: config.title,
    clss: config.clss,
    presets: config.presets,
    updateFilter: config.updateFilter,
    ondestroy: function (modal) {
      app.fireEvent('DidCloseFX_UI');

      app.stopListeningFor('DidStartPreview', modal._evstart);
      app.stopListeningFor('DidStopPreview', modal._evstop);
      app.stopListeningFor('DidTogglePreview', modal._evtoggle);
      app.stopListeningFor('DidSetPresets', modal._updatePresets);
      app.stopListeningFor('RequestActionFX_UPDATE_PREVIEW', modal._updpreview);
      app.stopListeningFor('RequestSetPresetActive', modal._updpreset);

      app.fireEvent('RequestActionFX_PREVIEW_STOP');

      // Remove the spacebar-preview shortcut registered in setup().
      app.ui.KeyHandler.removeCallback('ksp' + modal.id);

      config.ondestroy && config.ondestroy(modal);
    },
    toolbar: toolbar,
    buttons: config.buttons,
    body: config.body,
    onpreset: config.onpreset,
    setup: function (modal) {
      app.fireEvent('RequestActionFX_TOGGLE', 1);

      // `this` is the options object above; `this.toolbar` is the FX toolbar.
      const options = this;
      app.ui.KeyHandler.addCallback(
        'ksp' + modal.id,
        function () {
          if (!app.ui.InteractionHandler.check('modalfx')) return;

          const toolbarConfigs = options.toolbar;
          if (toolbarConfigs && toolbarConfigs.length > 0) {
            let index = toolbarConfigs.length;
            while (index-- > 0) {
              if (toolbarConfigs[index].title === 'Preview') {
                toolbarConfigs[index].callback(modal);
                break;
              }
            }
          }
        },
        [32]
      );

      modal._evstart = function () {
        modal.els.toolbar[0].classList.remove('pk_inact');
        modal.els.toolbar[1].classList.add('pk_act');
      };
      modal._evstop = function () {
        modal.els.toolbar[0].classList.add('pk_inact');
        modal.els.toolbar[1].classList.remove('pk_act');
      };

      modal._evtoggle = function (isOn) {
        const toggleLink = modal.els.toolbar[0];
        toggleLink.innerHTML = isOn ? 'ON' : 'OFF';
      };

      let stoppedListening = false;
      modal._updpreview = function (mode) {
        const selectedOption = modal.el_presets.options[modal.el_presets.selectedIndex];
        const editButton = modal.el.getElementsByClassName('pk_sel_edt')[0];

        if (mode === 't') {
          if (selectedOption && selectedOption.getAttribute('data-custom')) {
            editButton.style.visibility = 'visible';
            editButton.style.opacity = '1';
            app.stopListeningFor('RequestActionFX_UPDATE_PREVIEW', modal._updpreview);
          } else {
            editButton.style.visibility = 'hidden';
            editButton.style.opacity = '0';

            app.stopListeningFor('RequestActionFX_UPDATE_PREVIEW', modal._updpreview);

            setTimeout(function () {
              app.listenFor('RequestActionFX_UPDATE_PREVIEW', modal._updpreview);
            }, 100);
            stoppedListening = false;
          }
          return;
        }

        editButton.style.visibility = 'visible';
        editButton.style.opacity = '1';
        stoppedListening = true;
        app.stopListeningFor('RequestActionFX_UPDATE_PREVIEW', modal._updpreview);
      };

      modal._updpreset = function (fxId, presetId) {
        if (fxId && fxId !== modal.id) {
          return;
        }

        const presetOptions = modal.el_presets.getElementsByTagName('option');
        let index = presetOptions.length;

        while (index-- > 0) {
          const option = presetOptions[index];

          if (option.getAttribute('data-custom') === presetId) {
            option.selected = 'selected';
            break;
          }
        }
      };

      modal._updatePresets = function (fxId, presets) {
        if (fxId && fxId !== modal.id) {
          return;
        }

        let presetSelect = modal.el.getElementsByClassName('pk_sel');

        // If a preset dropdown already exists, refresh its custom entries.
        if (presetSelect.length > 0) {
          presetSelect = presetSelect[0];
          const existingOptions = presetSelect.getElementsByTagName('option');
          let index = existingOptions.length;

          while (index-- > 0) {
            const option = existingOptions[index];

            if (option.getAttribute('data-custom')) {
              presetSelect.removeChild(option);
            }
          }

          if (presets.length === 0) return;

          const separator = document.createElement('option');
          separator.setAttribute('disabled', '1');
          separator.setAttribute('data-custom', '1');
          separator.innerHTML = '----custom-----';
          presetSelect.appendChild(separator);

          for (const preset of presets) {
            const option = document.createElement('option');
            option.value = preset.val;
            option.setAttribute('data-custom', preset.id);
            option.innerHTML = preset.name;
            presetSelect.appendChild(option);
          }

          return;
        } else {
          presetSelect = document.createElement('select');
          presetSelect.className = 'pk_sel';
        }

        if (presets.length === 0) return;

        for (let i = -1; i < presets.length; ++i) {
          const option = document.createElement('option');

          if (i === -1) {
            option.value = 'null';
            option.innerHTML = 'Presets';
          } else {
            const preset = presets[i];
            option.value = preset.val;
            option.innerHTML = preset.name;
          }
          presetSelect.appendChild(option);
        }

        presetSelect.onchange = function () {
          const presetValues = this.value.split(',');
          const inputs = modal.el.getElementsByTagName('input');

          modal._updpreview('t');

          if (modal.onpreset) {
            modal.onpreset(this.value);
            return;
          }

          for (let i = 0; i < inputs.length; ++i) {
            if (!presetValues[i]) break;

            const value = presetValues[i].trim();
            const input = inputs[i];

            if (value === 'null') continue;

            if (input.type === 'checkbox' || input.type === 'radio') {
              input.checked = value;
            } else {
              input.value = value;
              input.oninput && input.oninput.apply(input);
            }
          }
        };

        const bottomBar = modal.el.getElementsByClassName('pk_modal_bottom')[0];
        bottomBar.appendChild(presetSelect);
        modal.el_presets = presetSelect;

        // "Save or modify preset" button next to the dropdown.
        const editPresetsButton = document.createElement('a');
        editPresetsButton.className = 'pk_sel_edt';
        editPresetsButton.innerHTML = '...<span>Save or Modify preset</span>';
        editPresetsButton.onclick = function () {
          app.fireEvent('RequestSavePreset');
        };

        bottomBar.appendChild(editPresetsButton);
        app.listenFor('RequestActionFX_UPDATE_PREVIEW', modal._updpreview);
        app.listenFor('RequestSetPresetActive', modal._updpreset);
      };

      app.listenFor('DidStartPreview', modal._evstart);
      app.listenFor('DidStopPreview', modal._evstop);
      app.listenFor('DidTogglePreview', modal._evtoggle);
      app.fireEvent('DidOpenFX_UI', modal);

      if (config.updateFilter) modal.updateFilter = config.updateFilter;

      if (config.presets) {
        modal._updatePresets(null, config.presets);
        if (config.custom_pres) modal._updatePresets(null, config.custom_pres);

        app.listenFor('DidSetPresets', modal._updatePresets);
      }

      config.setup && config.setup(modal);
    },
  });

  return effectModal;
}
