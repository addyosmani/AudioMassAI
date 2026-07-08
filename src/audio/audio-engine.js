/**
 * The audio engine.
 *
 * Owns the wavesurfer instance and translates the app's `Request*` events
 * into actual audio work: loading files/sessions, play/stop/seek, cut/copy/
 * paste, recording, every effect (via audioUtils.FXBank), zoom/pan, channel
 * toggling, undo/redo buffer swaps, and export.
 *
 * The `wavesurfer` build in public/vendor/ is patched by the AudioMass
 * author and calls back into this engine (e.g. `engine.ID3`,
 * `engine.wavesurfer.*`) through the global `PKAudioEditor` — keep those
 * property names stable.
 */

import { AudioUtils } from './audio-utils.js';
import { ID3v2, ID4 } from './id3-reader.js';
import { showToast } from '../ui/toast.js';
import { SimpleModal } from '../ui/modals.js';

export function AudioEngine(app) {
  var engine = this;

  var wavesurfer = WaveSurfer.create({
    container: '#' + 'pk_av_' + app.id,
    scrollParent: false,
    hideScrollbar: true,
    partialRender: false,
    fillParent: false,
    pixelRatio: 1,
    progressColor: 'rgba(128,85,85,0.24)',
    splitChannels: true,
    autoCenter: true,
    height: window.innerHeight - 168,
    plugins: [
      WaveSurfer.regions.create({
        dragSelection: {
          slop: 5,
        },
      }),
    ],
  });
  this.wavesurfer = wavesurfer;

  var audioUtils = new AudioUtils(app, wavesurfer);
  engine.is_ready = false;

  this.TrimTo = function (val, num) {
    var nums = { 0: 1, 1: 10, 2: 100, 3: 1000, 4: 10000, 5: 100000 };
    var dec = nums[num];
    return ((val * dec) >> 0) / dec;
  };

  // When a track is already loaded, ask whether to replace it or append
  // (choice is stored in wavesurfer.backend._add) before running loadFunc.
  var promptOpenOrAppend = function (loadFunc) {
    new SimpleModal({
      title: 'Open or append',
      clss: 'pk_modal_anim pk_fnt10',
      ondestroy: function () {
        app.ui.InteractionHandler.on = false;
        app.ui.KeyHandler.removeCallback('modalTempErr');
      },
      buttons: [
        {
          title: 'OPEN NEW',
          callback: function (modal) {
            wavesurfer.backend._add = 0;
            loadFunc();
            modal.Destroy();
          },
        },
        {
          title: 'ADD IN EXISTING',
          callback: function (modal) {
            wavesurfer.backend._add = 1;
            loadFunc();
            modal.Destroy();
          },
        },
      ],
      body: '<p>Append file to existing track?</p>',
      setup: function (modal) {
        app.ui.InteractionHandler.checkAndSet('modal');
        app.ui.KeyHandler.addCallback(
          'modalTempErr',
          function () {
            modal.Destroy();
          },
          [27]
        );
      },
    }).Show();
  };

  this.LoadArrayBuffer = function (e) {
    var func = function () {
      app.listenFor('RequestCancelModal', function () {
        wavesurfer.cancelBufferLoad();
        if (wavesurfer.arraybuffer) engine.is_ready = true;

        app.fireEvent('RequestResize');
        setTimeout(function () {
          app.fireEvent('DidDownloadFile');
        }, 12);
        app.stopListeningForName('RequestCancelModal');

        showToast('Canceled Loading', 1350);
      });

      app.fireEvent('RequestZoomUI', 0);

      app.fireEvent('WillDownloadFile');
      engine.is_ready = false;
      wavesurfer.loadBlob(e);
      app.fireEvent('DidUnloadFile');

      wavesurfer.regions && wavesurfer.regions.clear();
    };

    if (engine.is_ready) {
      promptOpenOrAppend(func);
      return;
    }

    wavesurfer.backend._add = 0;
    func();
    // ---
  };

  this.LoadDB = function (e) {
    var new_buffer = wavesurfer.backend.ac.createBuffer(
      e.data.length,
      e.data[0].byteLength / 4,
      e.samplerate
    );

    for (var i = 0; i < e.data.length; ++i) {
      var arr = new Float32Array(e.data[i]);

      if (new_buffer.copyToChannel) {
        new_buffer.copyToChannel(arr, i, 0);
      } else {
        var chan = new_buffer.getChannelData(i);
        chan.set(arr);
      }
    }

    var append = wavesurfer.backend._add;
    var old_duration = wavesurfer.getDuration();

    wavesurfer.loadDecodedBuffer(new_buffer);
    computeActiveChannels();
    var new_duration = wavesurfer.getDuration();
    app.fireEvent('DidUpdateLen', new_duration);

    if (!append) app.fireEvent('RequestSeekTo', 0);
    else {
      wavesurfer.regions.clear();
      wavesurfer.regions.add({
        start: old_duration,
        end: new_duration,
        id: 't',
      });
    }
    // --------
  };

  this.LoadFile = function (e) {
    if (e.files.length > 0) {
      if (
        e.files[0].type == 'audio/mp3' ||
        e.files[0].type == 'audio/wave' ||
        e.files[0].type == 'audio/mpeg' ||
        e.files[0].type == 'audio/aiff' ||
        e.files[0].type == 'audio/flac' ||
        e.files[0].type == 'audio/ogg'
      ) {
        var func = function () {
          app.listenFor('RequestCancelModal', function () {
            wavesurfer.cancelBufferLoad();
            audioUtils.DownloadFileCancel();
            if (wavesurfer.arraybuffer) engine.is_ready = true;

            app.fireEvent('RequestResize');
            setTimeout(function () {
              app.fireEvent('DidDownloadFile');
            }, 12);
            app.stopListeningForName('RequestCancelModal');

            showToast('Canceled Loading', 1350);
          });

          app.fireEvent('WillDownloadFile');
          engine.is_ready = false;
          wavesurfer.loadBlob(e.files[0]);
          app.fireEvent('DidUnloadFile');
          wavesurfer.regions && wavesurfer.regions.clear();
        };

        if (engine.is_ready) {
          promptOpenOrAppend(func);
          return;
        }

        wavesurfer.backend._add = 0;
        func();

        // ----
      }
    }
  };

  this.DownloadFile = function (name, format, kbps, selection, stereo) {
    if (!engine.is_ready) return;

    app.fireEvent('WillDownloadFile');

    app.listenFor('RequestCancelModal', function () {
      audioUtils.DownloadFileCancel();
      if (wavesurfer.arraybuffer) engine.is_ready = true;

      app.fireEvent('RequestResize');
      setTimeout(function () {
        app.fireEvent('DidDownloadFile');
      }, 12);
      app.stopListeningForName('RequestCancelModal');
    });

    setTimeout(function () {
      audioUtils.DownloadFile(name, format, kbps, selection, stereo, function (val) {
        if (val === 'done') {
          setTimeout(function () {
            app.fireEvent('DidDownloadFile');
          }, 12);
          app.stopListeningForName('RequestCancelModal');
        } else app.fireEvent('DidProgressModal', val);
      });
    }, 220);
  };
  this.LoadSample = function () {
    app.fireEvent('WillDownloadFile');

    setTimeout(function () {
      app.listenFor('RequestCancelModal', function () {
        if (wavesurfer.cancelAjax()) {
          if (wavesurfer.arraybuffer) engine.is_ready = true;

          app.fireEvent('RequestResize');
          setTimeout(function () {
            app.fireEvent('DidDownloadFile');
          }, 12);
          app.stopListeningForName('RequestCancelModal');

          showToast('Canceled Loading', 1380);
        }
      });

      app.fireEvent('RequestZoomUI', 0);
      engine.is_ready = false;
      wavesurfer.load('/samples/test.mp3');
    }, 180);
  };
  this.LoadURL = function (url) {
    app.fireEvent('WillDownloadFile');

    setTimeout(function () {
      app.listenFor('RequestCancelModal', function () {
        if (wavesurfer.cancelAjax()) {
          if (wavesurfer.arraybuffer) engine.is_ready = true;

          app.fireEvent('RequestResize');
          setTimeout(function () {
            app.fireEvent('DidDownloadFile');
          }, 12);
          app.stopListeningForName('RequestCancelModal');

          showToast('Canceled Loading', 1350);
        }
      });

      wavesurfer.load(url);
      engine.is_ready = false;
    }, 180);
  };

  app.listenFor('RequestResize', function () {
    wavesurfer.fireEvent('resize');

    var h = window.innerHeight;
    var bottom = 0;

    if (app.ui && app.ui.BarBtm) {
      bottom = app.ui.BarBtm.on ? app.ui.BarBtm.height : 0;
    }

    wavesurfer.setHeight((h < 280 ? 280 : h) - 168 - bottom);
    // app.fireEvent ('DidResize');
  });

  wavesurfer.on('ready', function () {
    app.fireEvent('DidReadyFire');

    if (wavesurfer.backend._add) {
      wavesurfer.backend._add = 0;
    }

    if (engine.is_ready) return;
    engine.is_ready = true;

    // dirty hack for default message
    var dirtymsg = document.getElementsByClassName('pk_tmpMsg');
    if (dirtymsg.length > 0) {
      dirtymsg = dirtymsg[0];
      dirtymsg.parentNode.removeChild(dirtymsg);
    }

    copy_buffer = null;
    app.fireEvent('DidDownloadFile');

    app.fireEvent('StateRequestClearAll');
    app.fireEvent('DidLoadFile');
    app.fireEvent('DidUpdateLen', wavesurfer.getDuration());
    app.fireEvent('DidSetClipboard', 0);
    app.fireEvent('RequestSeekTo', 0);

    app.fireEvent('RequestResize');
    wavesurfer.getWaveEl().style.opacity = '1';

    // loaded successfully
    app.stopListeningForName('RequestCancelModal');

    setTimeout(function () {
      showToast('Loaded Successfully');
    }, 180);

    // check if the audio file is mono or stereo and rebuild both UI and audio engine accordingly...
    if (wavesurfer.backend.buffer.numberOfChannels === 1) {
      wavesurfer.backend.SetNumberOfChannels(1);
      wavesurfer.ActiveChannels = [1];
      wavesurfer.drawer.params.ActiveChannels = wavesurfer.ActiveChannels;
      wavesurfer.SelectedChannelsLen = 1;

      app.el.classList.add('pk_mono');
    } else if (wavesurfer.backend.buffer.numberOfChannels === 2) {
      wavesurfer.backend.SetNumberOfChannels(2);
      wavesurfer.ActiveChannels = [1, 1];
      wavesurfer.drawer.params.ActiveChannels = wavesurfer.ActiveChannels;
      wavesurfer.SelectedChannelsLen = 2;

      app.el.classList.remove('pk_mono');
    }
    // ---
  });

  wavesurfer.on('pause', function () {
    app.fireEvent('DidStopPlay');
  });
  wavesurfer.on('play', function () {
    app.fireEvent('DidPlay');
  });
  wavesurfer.on('seek', function (where, stamp) {
    var time = wavesurfer.getCurrentTime();
    var loudness = wavesurfer.getLoudness();

    app.fireEvent('DidAudioProcess', [time, loudness, stamp]);
  });

  app.listenFor('RequestStop', function (val) {
    if (app.recorder.isActive()) {
      app.fireEvent('RequestActionRecordStop');
      return false;
    }

    var region = wavesurfer.regions.list[0];
    if (region) wavesurfer.ActiveMarker = region.start / wavesurfer.getDuration();

    wavesurfer.stop(val);
  });
  app.listenFor('RequestPlay', function (x) {
    // unique listener
    if (engine.in_fx) return;

    app.fireEvent('RequestActionRecordStop');

    if (!x && wavesurfer.isPlaying()) {
      wavesurfer.stop();
      wavesurfer.play();
    } else {
      if (!app.recorder.isActive()) {
        wavesurfer.play();
      } else {
        setTimeout(function () {
          if (!app.recorder.isActive() && !x && !wavesurfer.isPlaying()) {
            wavesurfer.play();
          }
        }, 220);
      }
    }
  });
  app.listenFor('RequestPause', function () {
    app.fireEvent('RequestActionRecordStop');
    wavesurfer.pause();
  });

  app.listenFor('RequestSetLoop', function () {
    if (!engine.is_ready) return;

    var skip_seek = false;

    if (wavesurfer.regions.list[0]) {
      if (wavesurfer.regions.list[0].loop) wavesurfer.regions.list[0].loop = false;
      else wavesurfer.regions.list[0].loop = true;
    } else {
      skip_seek = true;
      wavesurfer.regions.add({
        start: 0.01,
        end: wavesurfer.getDuration() - 0.01,
        id: 't',
      });
      wavesurfer.regions.list[0].loop = true;
    }

    var will_loop = wavesurfer.regions.list[0].loop;
    app.fireEvent('DidSetLoop', will_loop);
    if (will_loop && !skip_seek /*&& wavesurfer.isPlaying ()*/) {
      app.fireEvent('RequestSeekTo', wavesurfer.regions.list[0].start / wavesurfer.getDuration());
    }
  });
  app.listenFor('RequestSkipBack', function (val) {
    wavesurfer.skipBackward(val);
  });
  app.listenFor('RequestSkipFront', function (val) {
    wavesurfer.skipForward(val);
  });
  app.listenFor('RequestSeekTo', function (val) {
    if (val > 1.0) return;
    wavesurfer.seekTo(val);
  });
  app.ui.KeyHandler.addCallback(
    'zkA',
    function (key, m, e) {
      e.preventDefault();
    },
    [38]
  );
  app.ui.KeyHandler.addCallback(
    'zkD',
    function (key, m, e) {
      e.preventDefault();
    },
    [40]
  );
  app.ui.KeyHandler.addSingleCallback(
    'KeyPlayPause',
    function (e) {
      if (app.ui.InteractionHandler.on) return;
      e.preventDefault();
      //e.stopPropagation();
    },
    32
  );

  app.ui.KeyHandler.addSingleCallback(
    'KeyTilda',
    function (e) {
      var open_el = app.ui.TopHeader.getOpenElement();

      if (open_el) {
        app.ui.TopHeader.closeMenu();
        e.preventDefault();
        return;
      }

      if (app.ui.InteractionHandler.on) return;
      e.preventDefault();

      app.ui.TopHeader.openMenu(-1);
    },
    96
  );

  app.ui.KeyHandler.addSingleCallback(
    'KeyQ',
    function (e) {
      if (app.ui.InteractionHandler.on) return;
      e.preventDefault();
      app.fireEvent('RequestDeselect');
    },
    113
  );

  app.ui.KeyHandler.addCallback(
    'KeyShiftSpace' + app.id,
    function (key) {
      if (app.ui.InteractionHandler.on) return;
      wavesurfer.playPause();
    },
    [16, 32]
  );
  app.ui.KeyHandler.addCallback(
    'KeySpace' + app.id,
    function (key, map) {
      if (app.ui.InteractionHandler.on) return;
      if (map[16] === 1) return;

      if (wavesurfer.isPlaying()) {
        app.fireEvent('RequestStop');
      } else {
        app.fireEvent('RequestPlay');
      }
    },
    [32]
  );
  app.ui.KeyHandler.addCallback(
    'KeyShiftCopy' + app.id,
    function (key) {
      if (app.ui.InteractionHandler.on) return;

      app.fireEvent('RequestActionCopy');
    },
    [16, 67]
  );
  app.ui.KeyHandler.addCallback(
    'KeyShiftUndo' + app.id,
    function (key) {
      if (app.ui.InteractionHandler.on) return;

      app.fireEvent('StateRequestUndo');
    },
    [16, 90]
  );
  app.ui.KeyHandler.addCallback(
    'KeyShiftRedo' + app.id,
    function (key) {
      if (app.ui.InteractionHandler.on) return;

      app.fireEvent('StateRequestRedo');
    },
    [16, 89]
  );
  app.ui.KeyHandler.addCallback(
    'KeyShiftPaste' + app.id,
    function (key) {
      if (app.ui.InteractionHandler.on) return;

      app.fireEvent('RequestActionPaste');
    },
    [16, 86]
  );
  app.ui.KeyHandler.addCallback(
    'KeyShiftCut' + app.id,
    function (key) {
      if (app.ui.InteractionHandler.on) return;

      app.fireEvent('RequestActionCut', 1);
    },
    [16, 88]
  );
  app.ui.KeyHandler.addCallback(
    'KeyDel' + app.id,
    function (key) {
      if (app.ui.InteractionHandler.on) return;

      app.fireEvent('RequestActionCut');
    },
    [8]
  );
  app.ui.KeyHandler.addCallback(
    'KeyShiftSelectAll' + app.id,
    function (key) {
      if (app.ui.InteractionHandler.on) return;
      app.fireEvent('RequestSelect');
    },
    [16, 65]
  );
  app.ui.KeyHandler.addSingleCallback(
    'KeyLoopToggle',
    function (e) {
      if (app.ui.InteractionHandler.on) return;
      e.preventDefault();
      e.stopPropagation();
      app.fireEvent('RequestSetLoop');
    },
    108
  );
  app.ui.KeyHandler.addCallback(
    'KeyShiftSave' + app.id,
    function (key) {
      if (app.ui.InteractionHandler.on) return;

      // fire event to open the save menu
      document.querySelector('.pk_opt[data-id="dl"]').click();
    },
    [16, 83]
  );

  wavesurfer.container.addEventListener(
    'mousedown',
    function (e) {
      if (e.which === 3) {
        // wavesurfer.regions.clear();
        e.preventDefault();
      }
    },
    false
  );

  // select all... ####
  app.listenFor('RequestSelect', function (ifnot, custom) {
    if (!engine.is_ready) return;

    if (ifnot) {
      var region = wavesurfer.regions.list[0];
      if (region) return false;
    }

    if (!custom) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });

      if (!wavesurfer.isPlaying())
        setTimeout(function () {
          app.fireEvent('RequestSeekTo', 0.0);
        }, 0);
    } else {
      wavesurfer.regions.add({
        start: custom[0],
        end: custom[1],
        id: 't',
      });
      if (!wavesurfer.isPlaying())
        setTimeout(function () {
          app.fireEvent('RequestSeekTo', custom[0] / wavesurfer.getDuration());
        }, 0);
    }
  });
  app.listenFor('RequestDeselect', function () {
    wavesurfer.regions.clear();
    app.fireEvent('RequestSeekTo', 0);
  });

  (function () {
    var input = null;
    app.listenFor('RequestLoadLocalFile', function () {
      wavesurfer.pause();

      if (input) {
        input.parentNode.removeChild(input);
        input.onchange = null;
      }

      input = document.createElement('input');
      input.setAttribute('type', 'file');
      input.setAttribute('accept', 'audio/*');
      input.className = 'pk_inpfile';
      input.onchange = function () {
        engine.LoadFile(input);

        input.parentNode.removeChild(input);
        input.onchange = null;
        input = null;
      };
      app.el.appendChild(input); // maybe not append?

      input.click();
    });
  })();

  wavesurfer.container.addEventListener(
    'dblclick',
    function (e) {
      app.fireEvent('RequestSelect', false, [
        wavesurfer.LeftProgress,
        wavesurfer.LeftProgress + wavesurfer.VisibleDuration,
      ]);
    },
    false
  );
  wavesurfer.container.addEventListener(
    'click',
    function (e) {
      if (!engine.is_ready) return;

      if (!app.ui.KeyHandler.keyMap[16]) wavesurfer.regions.clear();
    },
    false
  );

  var resize_debounce = null;
  window.addEventListener(
    'resize',
    function () {
      if (!wavesurfer) return;

      if (resize_debounce) {
        clearTimeout(resize_debounce);
      }

      resize_debounce = setTimeout(function () {
        //requestAnimationFrame(function (){
        app.fireEvent('RequestResize');

        if (app.isMobile) {
          window.scrollTo(0, 200);
        }
        //});
      }, 84);
    },
    false
  );

  //		window.addEventListener ('orientationchange', function () {
  //  			app.fireEvent ('RequestResize');
  //		});

  window.addEventListener('beforeunload', function (e) {
    app.fireEvent('WillUnload');

    // e.preventDefault();
    // e.returnValue = '';
  });

  wavesurfer.on('error', function (error_msg) {
    // if loading - cancel loading
    setTimeout(function () {
      app.fireEvent('DidDownloadFile'); // just hides the interface
      engine.is_ready = false;
    }, 20);

    app.fireEvent('ShowError', error_msg);
  });

  wavesurfer.on('audioprocess', function (time, stamp) {
    // var time = wavesurfer.getCurrentTime();
    var loudness = wavesurfer.getLoudness();

    app.fireEvent('DidAudioProcess', [time, loudness, stamp], wavesurfer.backend.FreqArr);
  });
  wavesurfer.on('DidZoom', function (e) {
    app.fireEvent(
      'DidZoom',
      [
        wavesurfer.ZoomFactor,
        (wavesurfer.LeftProgress / wavesurfer.getDuration()) * 100,
        wavesurfer.params.verticalZoom,
      ],
      e
    );
  });
  wavesurfer.on('region-removed', function () {
    app.fireEvent('DidSetLoop', 0);
    app.fireEvent('DidDestroyRegion');
  });
  app.listenFor('RequestRegionClear', function () {
    wavesurfer.regions.clear();
  });
  app.listenFor('RequestRegionSet', function (start, end) {
    if (!engine.is_ready) return;

    if (!start) {
      start = wavesurfer.LeftProgress / 1;
    }
    if (!end) {
      end = (wavesurfer.LeftProgress + wavesurfer.VisibleDuration) / 1;
    }

    // add a region where the paste happened
    wavesurfer.regions.clear();
    wavesurfer.regions.add({
      start: start,
      end: end,
      id: 't',
    });
  });

  var copy_buffer = null;

  this.GetCopyBuff = function () {
    return copy_buffer;
  };

  this.GetSel = function () {
    var region = wavesurfer.regions.list[0];
    if (!region) return false;

    var start = engine.TrimTo(region.start, 3);
    var end = engine.TrimTo(region.end - region.start, 3);

    var copybuffer = audioUtils.Copy(start, end);

    return copybuffer;
  };

  this.PlayBuff = function (buff_arr, chans, sample_rate, aud_cont) {
    var audio_ctx;

    if (aud_cont) audio_ctx = aud_cont;
    else audio_ctx = new (window.AudioContext || window.webkitAudioContext)();

    if (!audio_ctx) return;

    var bytes = buff_arr[0].byteLength / 4;

    var buffer = audio_ctx.createBuffer(chans, bytes, sample_rate);

    for (var i = 0; i < chans; ++i) {
      buffer.getChannelData(i).set(new Float32Array(buff_arr[i]));
    }

    var source = audio_ctx.createBufferSource();
    source.buffer = buffer;

    source.connect(audio_ctx.destination);
    source.start(0);

    return source;
  };

  this.GetFX = function (fx, val) {
    return audioUtils.FXBank[fx](val);
  };

  this.GetWave = function (buffer, ww, hh, offset, llen, cnv, cx) {
    var chan_data = buffer.getChannelData(0);
    var sample_rate = buffer.sampleRate;

    var peaks = [];
    var curr_time = 0;
    var width = ww || 200;
    var height = hh || 80;
    var half_height = height / 2;
    var new_width = width;
    var pixels = 0;
    var raw_pixels = 0;

    var start_offset = offset || 0;
    var end_offset = llen || (buffer.duration * sample_rate) >> 0;
    var length = end_offset - start_offset;
    var mod = (length / width) >> 0;

    var max = 0;
    var min = 0;

    for (var i = 0; i < new_width; ++i) {
      var new_offset = start_offset + mod * i;

      max = 0;
      min = 0;

      if (new_offset >= 0) {
        for (var j = 0; j < mod; j += 3) {
          if (chan_data[new_offset + j] > max) {
            max = chan_data[new_offset + j];
          } else if (chan_data[new_offset + j] < min) {
            min = chan_data[new_offset + j];
          }
        }
      }

      peaks[2 * i] = max;
      peaks[2 * i + 1] = min;
    }

    var canvas = cnv;
    var ctx = cx;

    if (!canvas) {
      canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      ctx = canvas.getContext('2d', { alpha: false, antialias: false });
    }

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, width, height);
    ctx.fillStyle = '#99c2c6';

    ctx.beginPath();
    ctx.moveTo(0, half_height);

    for (var i = 0; i < width; ++i) {
      var peak = peaks[i * 2];
      var _h = Math.round(peak * half_height);
      ctx.lineTo(i, half_height - _h);
    }

    for (var i = width - 1; i >= 0; --i) {
      var peak = peaks[i * 2 + 1];
      var _h = Math.round(peak * half_height);
      ctx.lineTo(i, half_height - _h);
    }

    ctx.closePath();
    ctx.fill();

    return canvas.toDataURL('image/jpeg', 0.56);
    // ---
  };

  app.listenFor('RequestActionCut', function (use_clipboard) {
    if (!engine.is_ready) return;

    var region = wavesurfer.regions.list[0];
    if (!region) return false;

    app.fireEvent('RequestPause');

    var start = engine.TrimTo(region.start, 3);
    var end = engine.TrimTo(region.end - region.start, 3);

    app.fireEvent('StateRequestPush', {
      desc: use_clipboard ? 'Cut' : 'Delete',
      meta: [start, end],
      data: wavesurfer.backend.buffer,
    });

    var cutbuffer = audioUtils.Trim(start, end);
    wavesurfer.regions.clear();

    var tmp = start - 0.03;
    if (tmp < 0) tmp = 0;

    app.fireEvent('RequestSeekTo', tmp / wavesurfer.getDuration());

    if (use_clipboard) {
      copy_buffer = cutbuffer;

      app.fireEvent('DidSetClipboard', 1);
      app.fireEvent('DidCut', cutbuffer);

      showToast(
        'Cut :: ' + engine.TrimTo(start, 2) + ' to ' + engine.TrimTo(start / 1 + end / 1, 2),
        1100
      );
    } else {
      showToast(
        'Delete :: ' + engine.TrimTo(start, 2) + ' to ' + engine.TrimTo(start / 1 + end / 1, 2),
        1100
      );
    }
  });

  app.listenFor('RequestActionCopy', function () {
    if (!engine.is_ready) return;

    var region = wavesurfer.regions.list[0];
    if (!region) return false;

    app.fireEvent('RequestPause');

    var start = engine.TrimTo(region.start, 3);
    var end = engine.TrimTo(region.end - region.start, 3);

    var copybuffer = audioUtils.Copy(start, end);

    copy_buffer = copybuffer;
    app.fireEvent('DidSetClipboard', 1);
    app.fireEvent('DidCopy', copybuffer);

    showToast('Copied range');
  });

  app.listenFor('RequestActionSilence', function (offset, silence_duration) {
    if (!engine.is_ready) return;

    app.fireEvent('RequestPause');

    var region = wavesurfer.regions.list[0];
    var dims = [0, 0];

    if (!silence_duration || silence_duration < 0) silence_duration = 1;

    function handleStateInline(start, end) {
      app.fireEvent('StateRequestPush', {
        desc: 'Silence',
        meta: [start, end],
        data: wavesurfer.backend.buffer,
      });
    }

    var start = offset;
    var end = silence_duration;

    handleStateInline(start, end);
    dims = audioUtils.Insert(offset, audioUtils.MakeSilence(silence_duration));

    // add a region where the paste happened
    wavesurfer.regions.clear();
    wavesurfer.regions.add({
      start: dims[0],
      end: dims[1],
      id: 't',
    });

    app.fireEvent('RequestSeekTo', dims[0] / wavesurfer.getDuration());

    showToast('Inserted Silence');
  });

  app.listenFor('RequestActionPaste', function () {
    if (!engine.is_ready) return;
    if (!copy_buffer) return false;

    app.fireEvent('RequestPause');

    var region = wavesurfer.regions.list[0];
    var dims = [0, 0];

    function handleStateInline(start, end) {
      app.fireEvent('StateRequestPush', {
        desc: 'Paste',
        meta: [start, end],
        data: wavesurfer.backend.buffer,
      });
    }

    if (!region) {
      var offset = engine.TrimTo(wavesurfer.getCurrentTime(), 3);

      handleStateInline(offset);
      dims = audioUtils.Insert(offset, copy_buffer);
    } else {
      var start = engine.TrimTo(region.start, 3);
      var end = engine.TrimTo(region.end - region.start, 3);

      handleStateInline(start, end);

      dims = audioUtils.Replace(start, end, copy_buffer);
    }

    // add a region where the paste happened
    wavesurfer.regions.clear();
    wavesurfer.regions.add({
      start: dims[0],
      end: dims[1],
      id: 't',
    });

    var new_seek = 0;
    if (wavesurfer.getDuration() > 0.0001) {
      new_seek = dims[0] / wavesurfer.getDuration();
    }
    app.fireEvent('RequestSeekTo', new_seek);

    showToast('Paste to ' + dims[0].toFixed(2), 982);
  });

  var record_toggle_pending = false;
  app.listenFor('RequestActionRecordToggle', function () {
    if (!engine.is_ready) {
      // if not ready then bring up the new recording toggle!
      app.fireEvent('RequestActionNewRec');

      return;
    }

    if (app.recorder.isActive()) {
      app.fireEvent('RequestActionRecordStop');
    } else {
      // skipping the sounds of keyboard
      if (record_toggle_pending) return;

      record_toggle_pending = true;
      setTimeout(function () {
        app.fireEvent('RequestActionRecordStart');
        setTimeout(function () {
          record_toggle_pending = false;
        }, 50);
      }, 26);
    }
  });

  app.listenFor('RequestActionRecordStop', function () {
    if (!engine.is_ready) return;
    if (!app.recorder.isActive()) return false;

    app.recorder.stop();
  });

  app.listenFor('RequestActionRecordStart', function () {
    if (!engine.is_ready) return;

    app.fireEvent('RequestPause');

    if (app.recorder.isActive()) return false;

    var pos = wavesurfer.getCurrentTime() * wavesurfer.backend.buffer.sampleRate;
    app.recorder.start(
      pos,
      function (offset, buffers) {
        // app.fireEvent ('RequestPause');
        function handleStateInline(start, end) {
          app.fireEvent('StateRequestPush', {
            desc: 'Record Audio',
            meta: [start, end],
            data: wavesurfer.backend.buffer,
          });
        }

        // fire did record event!
        app.fireEvent('DidActionRecordStop', !!buffers);
        if (!buffers) {
          return;
        }

        handleStateInline(offset);
        var dims = audioUtils.ReplaceFloatArrays(offset, buffers);

        // add a region where the paste happened
        wavesurfer.regions.clear();
        wavesurfer.regions.add({
          start: dims[0],
          end: dims[1],
          id: 't',
        });

        app.fireEvent('RequestSeekTo', dims[0] / wavesurfer.getDuration());
        showToast('Recorded Audio ' + dims[0].toFixed(2), 982);
      },
      function () {
        // on start
        app.fireEvent('DidActionRecordStart');
      }
    );

    // --- ending offset is song full duration...
    // if we have a selected area - mark that one as the end
    var region = wavesurfer.regions.list[0];
    if (region) app.recorder.setEndingOffset(region.end * wavesurfer.backend.buffer.sampleRate);
    else
      app.recorder.setEndingOffset(wavesurfer.getDuration() * wavesurfer.backend.buffer.sampleRate);
  });

  app.listenFor('RequestActionFX_PREVIEW_HardLimit', function (val) {
    if (!engine.is_ready) return;
    if (audioUtils.previewing) {
      audioUtils.FXPreviewStop();
      app.fireEvent('DidStopPreview');
      return;
    }

    var region = wavesurfer.regions.list[0];
    var dims = [0, 0];

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    var start = engine.TrimTo(region.start, 3);
    var end = engine.TrimTo(region.end - region.start, 3);

    audioUtils.FXPreview(start, end, audioUtils.FXBank.HardLimit(val));
    app.fireEvent('DidStartPreview');
  });
  app.listenFor('RequestActionFX_HardLimit', function (val) {
    if (!engine.is_ready) return;

    app.fireEvent('RequestPause');

    var region = wavesurfer.regions.list[0];
    var dims = [0, 0];

    function handleStateInline(start, end) {
      app.fireEvent('StateRequestPush', {
        desc: 'Apply Hard Limit (fx)',
        meta: [start, end],
        data: wavesurfer.backend.buffer,
      });
    }

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    var start = engine.TrimTo(region.start, 3);
    var end = engine.TrimTo(region.end - region.start, 3);

    handleStateInline(start, end);
    audioUtils.FX(start, end, audioUtils.FXBank.HardLimit(val));

    showToast('Applied Hard Limit (fx)');
  });

  app.listenFor('RequestActionFX_PARAMEQ', function (val) {
    if (!engine.is_ready) return;

    app.fireEvent('RequestPause');

    var region = wavesurfer.regions.list[0];
    var dims = [0, 0];

    function handleStateInline(start, end) {
      app.fireEvent('StateRequestPush', {
        desc: 'Apply Parametric EQ (fx)',
        meta: [start, end],
        data: wavesurfer.backend.buffer,
      });
    }

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    var start = engine.TrimTo(region.start, 3);
    var end = engine.TrimTo(region.end - region.start, 3);

    handleStateInline(start, end);
    audioUtils.FX(start, end, audioUtils.FXBank.ParametricEQ(val));

    showToast('Applied Parametric EQ (fx)');
  });
  app.listenFor('RequestActionFX_PREVIEW_PARAMEQ', function (val) {
    if (!engine.is_ready || !val) return;
    if (audioUtils.previewing) {
      audioUtils.FXPreviewStop();
      app.fireEvent('DidStopPreview');
      return;
    }

    var region = wavesurfer.regions.list[0];
    var dims = [0, 0];

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    var start = engine.TrimTo(region.start, 3);
    var end = engine.TrimTo(region.end - region.start, 3);

    audioUtils.FXPreview(start, end, audioUtils.FXBank.ParametricEQ(val));
    app.fireEvent('DidStartPreview');
  });

  app.listenFor('RequestActionFX_PREVIEW_DISTORT', function (val) {
    if (!engine.is_ready) return;
    if (audioUtils.previewing) {
      audioUtils.FXPreviewStop();
      app.fireEvent('DidStopPreview');
      return;
    }

    var region = wavesurfer.regions.list[0];
    var dims = [0, 0];

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    var start = engine.TrimTo(region.start, 3);
    var end = engine.TrimTo(region.end - region.start, 3);

    audioUtils.FXPreview(start, end, audioUtils.FXBank.Distortion(val));
    app.fireEvent('DidStartPreview');
  });
  app.listenFor('RequestActionFX_DISTORT', function (val) {
    if (!engine.is_ready) return;

    app.fireEvent('RequestPause');

    var region = wavesurfer.regions.list[0];
    var dims = [0, 0];

    function handleStateInline(start, end) {
      app.fireEvent('StateRequestPush', {
        desc: 'Apply Distortion (fx)',
        meta: [start, end],
        data: wavesurfer.backend.buffer,
      });
    }

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    var start = engine.TrimTo(region.start, 3);
    var end = engine.TrimTo(region.end - region.start, 3);

    handleStateInline(start, end);
    audioUtils.FX(start, end, audioUtils.FXBank.Distortion(val));

    showToast('Applied Distortion (fx)');
  });

  app.listenFor('RequestActionFX_PREVIEW_DELAY', function (val) {
    if (!engine.is_ready) return;
    if (audioUtils.previewing) {
      audioUtils.FXPreviewStop();
      app.fireEvent('DidStopPreview');
      return;
    }

    var region = wavesurfer.regions.list[0];
    var dims = [0, 0];

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    var start = engine.TrimTo(region.start, 3);
    var end = engine.TrimTo(region.end - region.start, 3);

    audioUtils.FXPreview(start, end, audioUtils.FXBank.Delay(val));
    app.fireEvent('DidStartPreview');
  });
  app.listenFor('RequestActionFX_DELAY', function (val) {
    if (!engine.is_ready) return;

    app.fireEvent('RequestPause');

    var region = wavesurfer.regions.list[0];
    var dims = [0, 0];

    function handleStateInline(start, end) {
      app.fireEvent('StateRequestPush', {
        desc: 'Apply Delay (fx)',
        meta: [start, end],
        data: wavesurfer.backend.buffer,
      });
    }

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    var start = engine.TrimTo(region.start, 3);
    var end = engine.TrimTo(region.end - region.start, 3);

    handleStateInline(start, end);
    audioUtils.FX(start, end, audioUtils.FXBank.Delay(val));

    showToast('Applied Delay (fx)');
  });

  app.listenFor('RequestActionFX_PREVIEW_REVERB', function (val) {
    if (!engine.is_ready) return;
    if (audioUtils.previewing) {
      audioUtils.FXPreviewStop();
      app.fireEvent('DidStopPreview');
      return;
    }

    var region = wavesurfer.regions.list[0];
    var dims = [0, 0];

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    var start = engine.TrimTo(region.start, 3);
    var end = engine.TrimTo(region.end - region.start, 3);

    audioUtils.FXPreview(start, end, audioUtils.FXBank.Reverb(val));
    app.fireEvent('DidStartPreview');
  });
  app.listenFor('RequestActionFX_REVERB', function (val) {
    if (!engine.is_ready) return;

    app.fireEvent('RequestPause');

    var region = wavesurfer.regions.list[0];
    var dims = [0, 0];

    function handleStateInline(start, end) {
      app.fireEvent('StateRequestPush', {
        desc: 'Apply Reverb (fx)',
        meta: [start, end],
        data: wavesurfer.backend.buffer,
      });
    }

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    var start = engine.TrimTo(region.start, 3);
    var end = engine.TrimTo(region.end - region.start, 3);

    handleStateInline(start, end);
    audioUtils.FX(start, end, audioUtils.FXBank.Reverb(val));

    showToast('Applied Reverb (fx)');
  });

  app.listenFor('RequestActionFX_PREVIEW_COMPRESSOR', function (val) {
    if (!engine.is_ready) return;
    if (audioUtils.previewing) {
      audioUtils.FXPreviewStop();
      app.fireEvent('DidStopPreview');
      return;
    }

    var region = wavesurfer.regions.list[0];
    var dims = [0, 0];

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    var start = engine.TrimTo(region.start, 3);
    var end = engine.TrimTo(region.end - region.start, 3);

    audioUtils.FXPreview(start, end, audioUtils.FXBank.Compressor(val));
    app.fireEvent('DidStartPreview');
  });

  app.listenFor('RequestActionFX_Compressor', function (val) {
    if (!engine.is_ready) return;

    app.fireEvent('RequestPause');

    var region = wavesurfer.regions.list[0];
    var dims = [0, 0];

    function handleStateInline(start, end) {
      app.fireEvent('StateRequestPush', {
        desc: 'Apply Compressor (fx)',
        meta: [start, end],
        data: wavesurfer.backend.buffer,
      });
    }

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    var start = engine.TrimTo(region.start, 3);
    var end = engine.TrimTo(region.end - region.start, 3);

    handleStateInline(start, end);
    audioUtils.FX(start, end, audioUtils.FXBank.Compressor(val));

    showToast('Applied Compressor (fx)');
  });
  app.listenFor('RequestActionFX_Normalize', function (val) {
    if (!engine.is_ready) return;

    app.fireEvent('RequestPause');

    var region = wavesurfer.regions.list[0];
    var dims = [0, 0];

    function handleStateInline(start, end) {
      app.fireEvent('StateRequestPush', {
        desc: 'Normalize ',
        meta: [start, end],
        data: wavesurfer.backend.buffer,
      });
    }

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    var start = engine.TrimTo(region.start, 3);
    var end = engine.TrimTo(region.end - region.start, 3);

    handleStateInline(start, end);
    audioUtils.FX(start, end, audioUtils.FXBank.Normalize(val));

    showToast('Applied Normalize');
  });

  app.listenFor('RequestActionFX_Invert', function (val) {
    if (!engine.is_ready) return;

    app.fireEvent('RequestPause');

    var region = wavesurfer.regions.list[0];
    var dims = [0, 0];

    function handleStateInline(start, end) {
      app.fireEvent('StateRequestPush', {
        desc: 'Invert ',
        meta: [start, end],
        data: wavesurfer.backend.buffer,
      });
    }

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    var start = engine.TrimTo(region.start, 3);
    var end = engine.TrimTo(region.end - region.start, 3);

    handleStateInline(start, end);
    audioUtils.FX(start, end, audioUtils.FXBank.Invert());

    showToast('Applied Invert');
  });

  app.listenFor('RequestActionFX_RemSil', function (val) {
    if (!engine.is_ready) return;

    app.fireEvent('RequestPause');

    var region = wavesurfer.regions.list[0];
    var dims = [0, 0];

    function handleStateInline(start, end) {
      app.fireEvent('StateRequestPush', {
        desc: 'Remove Silence ',
        meta: [start, end],
        data: wavesurfer.backend.buffer,
      });
    }

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    var start = engine.TrimTo(region.start, 3);
    var end = engine.TrimTo(region.end - region.start, 3);

    handleStateInline(start, end);

    var originalBuffer = wavesurfer.backend.buffer;
    var sil_arr = [];
    var sil_offset = 210;
    var vol_offset = 56;
    var count = 0;
    var inv_count = 0;
    var start = 0;
    var end = 0;
    var found = false;
    var jump = 500;

    for (var i = 0; i < 1; ++i) {
      var channel = originalBuffer.getChannelData(i);

      for (var j = 0; j < channel.length; ++j) {
        if (Math.abs(channel[j]) < 0.000368) {
          if (count === 0) {
            if (j > jump) start = j - jump;
            else start = j;
          }
          if (++count > sil_offset) {
            inv_count = 0;
            end = j;
            found = true;
          }
        } else {
          if (found) {
            if (++inv_count > vol_offset) {
              sil_arr.push([start, end]);
              j += jump;

              count = 0;
              start = 0;
              end = 0;
              found = false;
              inv_count = 0;
            } else {
              end = j;
            }
          } else {
            count = 0;
            start = 0;
            end = 0;
            found = false;
            inv_count = 0;
          }
        }
      }

      if (found) {
        sil_arr.push([start, end]);
      }
    }

    if (sil_arr.length > 0) {
      var reduce = 0;
      for (var i = 0; i < sil_arr.length; ++i) {
        reduce += sil_arr[i][1] - sil_arr[i][0];
      }

      var emptySegment = wavesurfer.backend.ac.createBuffer(
        originalBuffer.numberOfChannels,
        originalBuffer.length - reduce,
        originalBuffer.sampleRate
      );

      for (var i = 0; i < originalBuffer.numberOfChannels; ++i) {
        var channel = originalBuffer.getChannelData(i);
        var new_channel = emptySegment.getChannelData(i);

        var sil_offset = 0;
        var o = 0;
        var sil_curr = sil_arr[o];
        var sil_curr_start = sil_curr[0];
        var sil_curr_end = sil_curr[1];
        var h = 0;
        var use_old = false;
        var old_h = 0;

        for (var j = 0; j < new_channel.length; ++j) {
          h = j + sil_offset;
          if (h > sil_curr_start && h < sil_curr_end) {
            if (h < sil_curr_start + jump) {
              var perc = (jump - (h - sil_curr_start)) / jump;
              new_channel[j] = channel[h] * perc; // / (h - sil_curr_start));
              new_channel[j] +=
                (1 - perc) * channel[j + (sil_offset + (sil_curr_end - sil_curr_start))];

              continue;
            } else {
              sil_offset = sil_offset + (sil_curr_end - sil_curr_start);
              sil_curr = sil_arr[++o];
              if (sil_curr) {
                sil_curr_start = sil_curr[0];
                sil_curr_end = sil_curr[1];
              }
              h = j + sil_offset;
            }
          }

          new_channel[j] = channel[h];
        }
      }

      audioUtils.FullReplace(emptySegment);
    }

    setTimeout(function () {
      wavesurfer.drawBuffer();
    }, 40);

    showToast('Applied :: Remove Silence');
  });

  var computeActiveChannels = function () {
    var buff = wavesurfer.backend.buffer;
    var chans = buff.numberOfChannels;

    if (chans === 1) {
      wavesurfer.ActiveChannels = [1];
      app.el.classList.add('pk_mono');
    } else {
      wavesurfer.ActiveChannels = [1, 1];
      app.el.classList.remove('pk_mono');
    }

    wavesurfer.drawer.params.ActiveChannels = wavesurfer.ActiveChannels;
    wavesurfer.SelectedChannelsLen = chans;
  };

  app.listenFor('RequestActionFX_Flip', function (val, val2) {
    if (!engine.is_ready) return;

    app.fireEvent('RequestPause');

    var start = 0;
    var end = wavesurfer.getDuration();

    function handleStateInline(start, end, title, cb) {
      app.fireEvent('StateRequestPush', {
        desc: title,
        meta: [start, end],
        data: wavesurfer.backend.buffer,
        cb: cb,
      });
    }

    if (val === 'flip') {
      handleStateInline(start, end, 'Flip Channels');
      audioUtils.FX(start, end, audioUtils.FXBank.Flip(val));
    } else if (val === 'stereo') {
      handleStateInline(start, end, 'Make Stereo', function () {
        computeActiveChannels();
      });

      var originalBuffer = wavesurfer.backend.buffer;
      var emptySegment = wavesurfer.backend.ac.createBuffer(
        2,
        originalBuffer.length,
        originalBuffer.sampleRate
      );
      emptySegment.getChannelData(0).set(originalBuffer.getChannelData(0));
      emptySegment.getChannelData(1).set(originalBuffer.getChannelData(0));

      audioUtils.FullReplace(emptySegment);

      wavesurfer.regions.clear();
      wavesurfer.regions.add({
        start: start,
        end: end,
        id: 't',
      });

      computeActiveChannels();

      app.fireEvent('RequestSeekTo', 0.0);
    } else if (val === 'mono') {
      handleStateInline(start, end, 'Make Mono', function () {
        computeActiveChannels();
      });

      var originalBuffer = wavesurfer.backend.buffer;
      var emptySegment = wavesurfer.backend.ac.createBuffer(
        1,
        originalBuffer.length,
        originalBuffer.sampleRate
      );
      emptySegment.getChannelData(0).set(originalBuffer.getChannelData(val2));
      audioUtils.FullReplace(emptySegment);

      wavesurfer.regions.clear();
      wavesurfer.regions.add({
        start: start,
        end: end,
        id: 't',
      });

      computeActiveChannels();

      app.fireEvent('RequestSeekTo', 0.0);
    }

    showToast('Applied Channel Change: ' + val);
  });

  app.listenFor('RequestActionFX_Reverse', function (val) {
    if (!engine.is_ready) return;

    app.fireEvent('RequestPause');

    var region = wavesurfer.regions.list[0];
    var dims = [0, 0];

    function handleStateInline(start, end) {
      app.fireEvent('StateRequestPush', {
        desc: 'Reverse ',
        meta: [start, end],
        data: wavesurfer.backend.buffer,
      });
    }

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    var start = engine.TrimTo(region.start, 3);
    var end = engine.TrimTo(region.end - region.start, 3);

    handleStateInline(start, end);
    audioUtils.FX(start, end, audioUtils.FXBank.Reverse());

    showToast('Applied Reverse');
  });

  // RNNoise-based noise reduction. The WASM build (~2MB) is loaded lazily
  // the first time the effect is used; `wasm_denoise_stream_perf` is the
  // global it exposes (see public/vendor/rnn_denoise.js).
  var rnnoise_loaded = false;
  app.listenFor('RequestActionFX_NoiseRNN', function () {
    if (!engine.is_ready) return;

    app.fireEvent('RequestPause');

    var applyDenoise = function () {
      var region = wavesurfer.regions.list[0];
      if (!region) {
        wavesurfer.regions.add({ start: 0, end: wavesurfer.getDuration(), id: 't' });
        region = wavesurfer.regions.list[0];
      }

      var start = engine.TrimTo(region.start, 3);
      var end = engine.TrimTo(region.end - region.start, 3);
      var duration = engine.TrimTo(region.end - region.start, 3);

      app.fireEvent('StateRequestPush', {
        desc: 'Apply Noise RNN (fx)',
        meta: [start, end],
        data: wavesurfer.backend.buffer,
      });

      var segment = audioUtils.Copy(start, end);
      for (var i = 0; i < segment.numberOfChannels; i++) {
        var channelData = segment.getChannelData(i);
        var denoised = wasm_denoise_stream_perf(channelData);
        channelData.set(denoised);
      }
      audioUtils.Replace(start, end, segment);

      app.fireEvent('RequestSeekTo', start / wavesurfer.getDuration());
      wavesurfer.regions.clear();
      wavesurfer.regions.add({ start: start, end: start + duration, id: 't' });

      showToast('Applied Noise RNN (fx)');
    };

    if (rnnoise_loaded) {
      applyDenoise();
      return;
    }

    var script = document.createElement('script');
    script.src = '/vendor/rnn_denoise.js';
    script.onload = function () {
      rnnoise_loaded = true;

      // Wait until the Emscripten runtime is fully initialized.
      var waitForWasm = function () {
        if (window.Module && window.Module.asm && window.Module.asm.malloc) {
          applyDenoise();
        } else {
          setTimeout(waitForWasm, 350);
        }
      };
      setTimeout(waitForWasm, 100);
    };
    script.onerror = function () {
      alert('Could not download noise Reduction script');
    };
    document.head.appendChild(script);
  });

  app.listenFor('RequestActionFX_FadeIn', function (val) {
    if (!engine.is_ready) return;

    app.fireEvent('RequestPause');

    var region = wavesurfer.regions.list[0];
    var dims = [0, 0];

    function handleStateInline(start, end) {
      app.fireEvent('StateRequestPush', {
        desc: 'Apply Fade In (fx)',
        meta: [start, end],
        data: wavesurfer.backend.buffer,
      });
    }

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    var start = engine.TrimTo(region.start, 3);
    var end = engine.TrimTo(region.end - region.start, 3);

    handleStateInline(start, end);
    audioUtils.FX(start, end, audioUtils.FXBank.FadeIn());

    showToast('Applied Fade In (fx)');
  });
  app.listenFor('RequestActionFX_FadeOut', function (val) {
    if (!engine.is_ready) return;

    app.fireEvent('RequestPause');

    var region = wavesurfer.regions.list[0];
    var dims = [0, 0];

    function handleStateInline(start, end) {
      app.fireEvent('StateRequestPush', {
        desc: 'Apply Fade Out (fx)',
        meta: [start, end],
        data: wavesurfer.backend.buffer,
      });
    }

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    var start = engine.TrimTo(region.start, 3);
    var end = engine.TrimTo(region.end - region.start, 3);

    handleStateInline(start, end);
    audioUtils.FX(start, end, audioUtils.FXBank.FadeOut());

    showToast('Applied Fade Out (fx)');
  });

  var fx_preview_debounce = null;
  app.listenFor('RequestActionFX_UPDATE_PREVIEW', function (val) {
    if (!audioUtils.previewing) return;

    clearTimeout(fx_preview_debounce);
    fx_preview_debounce = setTimeout(function () {
      audioUtils.FXPreviewUpdate(val);
    }, 44);
  });
  app.listenFor('RequestActionFX_TOGGLE', function (val) {
    if (val) {
      audioUtils.FXPreviewInit(true);
      return;
    }

    app.fireEvent('DidTogglePreview', audioUtils.FXPreviewToggle());
  });
  app.listenFor('RequestActionFX_PREVIEW_STOP', function () {
    audioUtils.FXPreviewStop();
    app.fireEvent('DidStopPreview');
  });
  app.listenFor('RequestActionFX_PREVIEW_GAIN', function (val) {
    if (!engine.is_ready) return;
    if (audioUtils.previewing) {
      audioUtils.FXPreviewStop();
      app.fireEvent('DidStopPreview');
      return;
    }

    var region = wavesurfer.regions.list[0];
    var dims = [0, 0];

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    var start = engine.TrimTo(region.start, 3);
    var end = engine.TrimTo(region.end - region.start, 3);

    audioUtils.FXPreview(start, end, audioUtils.FXBank.Gain(val));

    app.fireEvent('DidStartPreview');
  });

  app.listenFor('RequestActionFX_GAIN', function (val) {
    if (!engine.is_ready) return;

    app.fireEvent('RequestPause');

    var region = wavesurfer.regions.list[0];
    var dims = [0, 0];

    function handleStateInline(start, end) {
      app.fireEvent('StateRequestPush', {
        desc: 'Apply Gain (fx)',
        meta: [start, end],
        data: wavesurfer.backend.buffer,
      });
    }

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    var start = engine.TrimTo(region.start, 3);
    var end = engine.TrimTo(region.end - region.start, 3);

    handleStateInline(start, end);
    audioUtils.FX(start, end, audioUtils.FXBank.Gain(val));

    showToast('Applied Gain (fx)');
  });

  app.listenFor('RequestActionFX_PREVIEW_SPEED', function (val) {
    if (!engine.is_ready) return;
    if (audioUtils.previewing) {
      audioUtils.FXPreviewStop();
      app.fireEvent('DidStopPreview');
      return;
    }

    var region = wavesurfer.regions.list[0];
    var dims = [0, 0];

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    var start = engine.TrimTo(region.start, 3);
    var end = engine.TrimTo(region.end - region.start, 3);

    audioUtils.FXPreview(start, end, audioUtils.FXBank.Speed(val));

    app.fireEvent('DidStartPreview');
  });

  app.listenFor('RequestActionFX_RATE', function (val) {
    if (!engine.is_ready) return;

    app.fireEvent('RequestPause');

    var region = wavesurfer.regions.list[0];
    var dims = [0, 0];

    function handleStateInline(start, end) {
      app.fireEvent('StateRequestPush', {
        desc: 'Apply Rate (fx)',
        meta: [start, end],
        data: wavesurfer.backend.buffer,
      });
    }

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    var start = engine.TrimTo(region.start, 3);
    var end = engine.TrimTo(region.end - region.start, 3);
    var duration = (region.end - region.start) / val;
    duration = engine.TrimTo(duration, 3);

    handleStateInline(start, end);

    var fx_buffer = audioUtils.Copy(start, end);
    var originalBuffer = wavesurfer.backend.buffer;
    var new_offset = ((start / 1) * originalBuffer.sampleRate) >> 0;
    var new_len = ((duration / 1) * originalBuffer.sampleRate) >> 0;
    var old_len = ((end / 1) * originalBuffer.sampleRate) >> 0;
    var stretch_ratio = new_len / old_len;

    var getOfflineAudioContext = function (channels, sampleRate, duration) {
      return new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(
        channels,
        duration,
        sampleRate
      );
    };
    var audio_ctx = getOfflineAudioContext(
      // offlineCtx
      wavesurfer.SelectedChannelsLen, // orig_buffer.numberOfChannels,
      fx_buffer.sampleRate,
      new_len
    );

    var stretchAudio = function (input_buffer, sampleRate, stretchRatio) {
      // Parameters (in seconds)
      let channels_len = input_buffer.numberOfChannels;
      let samples = [input_buffer.getChannelData(0)];
      for (let i = 1; i < channels_len; ++i) {
        samples.push(input_buffer.getChannelData(i));
      }

      let grainDurationSec = 0.05; // 50 ms
      const analysisHopSec = 0.025; // 25 ms (50% overlap)
      const desiredOverlap = 0.5;
      const synthesisHopSec = analysisHopSec * stretchRatio; // output hop

      // Adjust grain duration for ratios > 1
      if (stretchRatio > 1) {
        grainDurationSec = synthesisHopSec / (1 - desiredOverlap);
      }

      // Convert durations to samples
      const grainSize = Math.floor(grainDurationSec * sampleRate);
      const analysisHop = Math.floor(analysisHopSec * sampleRate);
      const synthesisHop = Math.floor(synthesisHopSec * sampleRate);

      // Precompute Hann window
      const window = new Float32Array(grainSize);
      for (let i = 0; i < grainSize; i++) {
        // Using (grainSize - 1) so that the window spans [0, grainDurationSec]
        window[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (grainSize - 1)));
      }

      // Estimate number of grains and output length
      const numGrains = Math.floor((samples[0].length - grainSize) / analysisHop);
      const outputLength = synthesisHop * numGrains + grainSize;
      let output = [new Float32Array(outputLength)];
      for (let i = 1; i < channels_len; ++i) {
        output.push(new Float32Array(outputLength));
      }

      // Process each grain: copy, window, and add to output
      let inputIndex = 0;
      let outputIndex = 0;
      for (let n = 0; n < numGrains; ++n) {
        // For each sample in the grain, multiply by the window and add to the output
        for (let i = 0; i < grainSize; ++i) {
          for (let j = 0; j < channels_len; ++j) {
            output[j][outputIndex + i] += samples[j][inputIndex + i] * window[i];
          }
        }
        inputIndex += analysisHop;
        outputIndex += synthesisHop;
      }

      return output;
    };

    /// -----
    var filter = [];
    //if (stretch_ratio < 1) {
    //	var fx = audioUtils.FXBank.Rate( stretch_ratio );
    //	var source = {buffer:null, disconnect:function(){}};
    //	source.buffer = fx_buffer;
    //	filter = fx.filter ( audio_ctx, audio_ctx.destination, source, duration );
    //}
    //else
    //{
    // use timestretcher here...
    // var ts = new TimeStretcher({windowSize:2048,overlapRatio:0.75,seekWindowMs:20}).stretch(fx_buffer,stretch_ratio);
    const stretchedSamples = stretchAudio(fx_buffer, fx_buffer.sampleRate, stretch_ratio);

    // Optionally, if you need an AudioBuffer from the stretchedSamples:
    // const offlineCtx = new OfflineAudioContext(stretchedSamples.length, stretchedSamples[0].length, fx_buffer.sampleRate);
    const newBuffer = audio_ctx.createBuffer(
      stretchedSamples.length,
      stretchedSamples[0].length,
      fx_buffer.sampleRate
    );

    for (let i = 0; i < stretchedSamples.length; ++i) {
      newBuffer.copyToChannel(stretchedSamples[i], i);
    }

    var source = audio_ctx.createBufferSource();
    source.buffer = newBuffer;
    source.connect(audio_ctx.destination);
    source.start();
    //}

    engine.in_fx = true;
    app.ui.InteractionHandler.on = true;
    // showToast ('Please wait, applying FX', 2600);

    var offline_callback = function (rendered_buffer) {
      audioUtils.Replace(start, end, rendered_buffer);

      wavesurfer.regions.clear();
      wavesurfer.regions.add({
        start: start,
        end: start + duration,
        id: 't',
      });

      app.fireEvent('RequestSeekTo', start / wavesurfer.getDuration());

      showToast('Applied Rate (fx)');

      if (filter.length > 0) {
        for (var i = 0; i < filter.length; ++i) filter[i].disconnect();
      } else filter && filter.disconnect && filter.disconnect();

      rendered_buffer = fx_buffer = filter = null;
      source.disconnect();

      engine.in_fx = false;
      app.ui.InteractionHandler.on = false;
    };

    var offline_renderer = audio_ctx.startRendering();
    if (offline_renderer)
      offline_renderer.then(offline_callback).catch(function (err) {
        console.log('Rendering failed: ' + err);
      });
    else
      audio_ctx.oncomplete = function (e) {
        offline_callback(e.renderedBuffer);
      };
  });

  app.listenFor('RequestActionFX_PREVIEW_RATE', function (val) {
    if (!engine.is_ready) return;
    if (audioUtils.previewing) {
      audioUtils.FXPreviewStop();
      app.fireEvent('DidStopPreview');
      return;
    }

    var region = wavesurfer.regions.list[0];
    var dims = [0, 0];

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    var start = engine.TrimTo(region.start, 3);
    var end = engine.TrimTo(region.end - region.start, 3);
    var duration = (region.end - region.start) / val;

    var originalBuffer = wavesurfer.backend.buffer;
    var new_offset = ((start / 1) * originalBuffer.sampleRate) >> 0;
    var new_len = ((duration / 1) * originalBuffer.sampleRate) >> 0;
    var old_len = ((end / 1) * originalBuffer.sampleRate) >> 0;

    // -----
    var stretch_ratio = new_len / old_len;

    audioUtils.FXPreview(start, end, audioUtils.FXBank.Rate(stretch_ratio));

    app.fireEvent('DidStartPreview');
  });

  app.listenFor('RequestActionFX_SPEED', function (val) {
    if (!engine.is_ready) return;

    app.fireEvent('RequestPause');

    var region = wavesurfer.regions.list[0];
    var dims = [0, 0];

    function handleStateInline(start, end) {
      app.fireEvent('StateRequestPush', {
        desc: 'Apply Speed (fx)',
        meta: [start, end],
        data: wavesurfer.backend.buffer,
      });
    }

    if (!region) {
      wavesurfer.regions.add({
        start: 0.0,
        end: wavesurfer.getDuration() - 0.0,
        id: 't',
      });
      region = wavesurfer.regions.list[0];
    }

    var start = engine.TrimTo(region.start, 3);
    var end = engine.TrimTo(region.end - region.start, 3);
    var duration = (region.end - region.start) / val;
    duration = engine.TrimTo(duration, 3);

    handleStateInline(start, end);

    var fx_buffer = audioUtils.Copy(start, end);
    var originalBuffer = wavesurfer.backend.buffer;
    var new_offset = ((start / 1) * originalBuffer.sampleRate) >> 0;
    var new_len = ((duration / 1) * originalBuffer.sampleRate) >> 0;
    var old_len = ((end / 1) * originalBuffer.sampleRate) >> 0;

    /*
			var emptySegment = wavesurfer.backend.ac.createBuffer (
				wavesurfer.SelectedChannelsLen,
				new_len,
				originalBuffer.sampleRate
			);*/

    engine.in_fx = true;
    app.ui.InteractionHandler.on = true;
    var fx = audioUtils.FXBank.Speed(val);

    var getOfflineAudioContext = function (channels, sampleRate, duration) {
      return new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(
        channels,
        duration,
        sampleRate
      );
    };
    var audio_ctx = getOfflineAudioContext(
      wavesurfer.SelectedChannelsLen, // orig_buffer.numberOfChannels,
      originalBuffer.sampleRate,
      new_len
    );

    var source = audio_ctx.createBufferSource();
    source.buffer = fx_buffer;

    var filter = fx.filter(audio_ctx, audio_ctx.destination, source, duration);

    source.start();

    var offline_callback = function (rendered_buffer) {
      audioUtils.Replace(start, end, rendered_buffer);

      wavesurfer.regions.clear();
      wavesurfer.regions.add({
        start: start,
        end: start + duration,
        id: 't',
      });

      app.fireEvent('RequestSeekTo', start / wavesurfer.getDuration());

      showToast('Applied Speed (fx)');

      if (filter.length > 0) {
        for (var i = 0; i < filter.length; ++i) filter[i].disconnect();
      } else filter && filter.disconnect && filter.disconnect();

      // is this needed?
      rendered_buffer = fx_buffer = filter = null;
      source.disconnect();
      // audio_ctx.close ();
      // -
      engine.in_fx = false;
      app.ui.InteractionHandler.on = false;
    };

    var offline_renderer = audio_ctx.startRendering();
    if (offline_renderer)
      offline_renderer.then(offline_callback).catch(function (err) {
        console.log('Rendering failed: ' + err);
      });
    else
      audio_ctx.oncomplete = function (e) {
        offline_callback(e.renderedBuffer);
      };
  });

  app.listenFor('StateDidPop', function (state, undo) {
    if (!engine.is_ready) return;
    app.fireEvent('RequestPause');

    wavesurfer.regions.clear();
    wavesurfer.loadDecodedBuffer(state.data);

    if (state.cb) state.cb();

    var new_duration = wavesurfer.getDuration();
    app.fireEvent('DidUpdateLen', new_duration);

    if (state.meta && state.meta.length > 0) {
      if (state.meta[1]) {
        wavesurfer.regions.add({
          start: state.meta[0] / 1,
          end: state.meta[0] / 1 + state.meta[1] / 1,
          id: 't',
        });
      } else {
        if (!new_duration) new_duration = 0.0001;
        app.fireEvent('RequestSeekTo', state.meta[0] / new_duration);
      }
    }

    if (undo) showToast('Undo ' + state.desc);
    else showToast('Redo ' + state.desc);
  });

  // ---
  app.listenFor('RequestChanToggle', function (chan_index, force_val) {
    if (!engine.is_ready) return false;

    if (wavesurfer.ActiveChannels.length <= chan_index) return false;

    var oldval = wavesurfer.ActiveChannels[chan_index];
    var val = -1;

    if (force_val) val = force_val;
    else {
      if (oldval === 1) val = 0;
      else val = 1;
    }

    if (oldval !== val) {
      wavesurfer.ActiveChannels[chan_index] = val;
      if (val === 0) {
        --wavesurfer.SelectedChannelsLen;
        // silece the channel itself

        if (chan_index === 0) {
          wavesurfer.backend.gainNode2.gain.value = 0.0;
        } else {
          wavesurfer.backend.gainNode1.gain.value = 0.0;
        }
      } else {
        ++wavesurfer.SelectedChannelsLen;

        if (chan_index === 0) {
          wavesurfer.backend.gainNode2.gain.value = 1.0;
        } else {
          wavesurfer.backend.gainNode1.gain.value = 1.0;
        }
      }

      wavesurfer.ForceDraw();
      app.fireEvent('DidChanToggle', chan_index, val);
    }
  });

  // ----
  wavesurfer.on('region-updated', function () {
    if (wavesurfer.regions.list[0]) {
      app.fireEvent('DidCreateRegion', wavesurfer.regions.list[0]);
    }
  });
  wavesurfer.on('region-update-end', function () {
    app.fireEvent('DidCreateRegion', wavesurfer.regions.list[0]);

    var start = wavesurfer.regions.list[0].start;
    if (!wavesurfer.isPlaying()) app.fireEvent('RequestSeekTo', start / wavesurfer.getDuration());
  });
  wavesurfer.on('cursorcenter', function (e) {
    app.fireEvent('DidCursorCenter', e, wavesurfer.ZoomFactor);
  });

  var wave = wavesurfer.drawer.canvases[0].wave.parentNode;

  var drag_x = 0;
  var drag_move = function (e) {
    var diff = drag_x - e.clientX;

    // find diff percentage from full width...

    // drag the waveform now
    app.fireEvent('RequestPan', diff);

    drag_x = e.clientX;
  };

  app.listenFor('RequestZoom', function (diff, mode) {
    var wv = wavesurfer;

    // compute new ZoomFactor...
    diff *= wv.ZoomFactor;

    // compute availabel left ZoomFactor
    if (mode === -1) {
      var width = wv.drawer.width;
      var available_pixels = width - width / wv.ZoomFactor;
      var target = wv.ZoomFactor - 1;
      if (target <= 0) return;

      var old_zoomfactor = wv.ZoomFactor;
      wv.ZoomFactor += (diff * target) / available_pixels;
      if (wv.ZoomFactor < 1) wv.ZoomFactor = 1;

      var new_vis_dur = wv.getDuration() / wv.ZoomFactor;

      if (new_vis_dur <= 0.5) {
        wv.ZoomFactor = old_zoomfactor;
        return;
      }

      wv.VisibleDuration = new_vis_dur;

      var time_moved = wv.VisibleDuration * (diff / wv.drawer.width);
      wv.LeftProgress += time_moved;

      if (wv.LeftProgress + wv.VisibleDuration >= wv.getDuration()) {
        wv.LeftProgress = wv.getDuration() - wv.VisibleDuration;
      } else if (wv.LeftProgress < 0) {
        wv.LeftProgress = 0;
      }
    } else if (mode === 1) {
      var width = wv.drawer.width;
      var available_pixels = width - width / wv.ZoomFactor;
      var target = wv.ZoomFactor - 1;
      if (target <= 0) return;

      var old_factor = wv.ZoomFactor;
      wv.ZoomFactor -= (diff * target) / available_pixels;
      if (wv.ZoomFactor < 1) wv.ZoomFactor = 1;
      var temp = wv.getDuration() / wv.ZoomFactor;
      if (temp + wv.LeftProgress > wv.getDuration()) {
        wv.ZoomFactor = old_factor;
      } else {
        if (temp <= 0.5) {
          wv.ZoomFactor = old_factor;
          return;
        }

        wv.VisibleDuration = temp;
      }
      // -
    }

    // wv.ZoomFactor -= Math.abs (diff / (wv.drawer.width / 2));
    // console.log( diff + " BLAH " + wv.ZoomFactor + '   ' +  (diff / wv.drawer.width) );
    wv.ForceDraw();
    app.fireEvent('DidZoom', [
      wavesurfer.ZoomFactor,
      (wavesurfer.LeftProgress / wavesurfer.getDuration()) * 100,
      wavesurfer.params.verticalZoom,
    ]);
  });

  app.listenFor('RequestPan', function (diff, mode) {
    var wv = wavesurfer;

    if (mode === 1) diff *= wv.ZoomFactor;
    else if (mode === 2) {
      var time_moved = wv.getDuration() * (diff / wv.drawer.width);
      wv.LeftProgress = time_moved;

      wv.ForceDraw();
      app.fireEvent('DidZoom', [
        wavesurfer.ZoomFactor,
        (wavesurfer.LeftProgress / wavesurfer.getDuration()) * 100,
        wavesurfer.params.verticalZoom,
      ]);

      return;
    }

    if (wv.ZoomFactor > 0) {
      // drag and draw by X pixels...
      var time_moved = wv.VisibleDuration * (diff / wv.drawer.width);
      wv.LeftProgress += time_moved;

      if (wv.LeftProgress + wv.VisibleDuration >= wv.getDuration()) {
        wv.LeftProgress = wv.getDuration() - wv.VisibleDuration;
      } else if (wv.LeftProgress < 0) {
        wv.LeftProgress = 0;
      }

      wv.ForceDraw();
      app.fireEvent('DidZoom', [
        wavesurfer.ZoomFactor,
        (wavesurfer.LeftProgress / wavesurfer.getDuration()) * 100,
        wavesurfer.params.verticalZoom,
      ]);
    }
  });

  wave.addEventListener(
    'mousedown',
    function (e) {
      if (e.which === 3) {
        e.preventDefault();

        wavesurfer.Interacting |= 1 << 1;

        drag_x = e.clientX;
        wave.className = 'pk_grabbing';

        document.addEventListener('mousemove', drag_move, false);
        return false;
      } else {
        app.fireEvent('MouseDown');
        app.fireEvent('RequestChanToggle', 0, 1);
        app.fireEvent('RequestChanToggle', 1, 1);
      }
    },
    false
  );
  wave.addEventListener(
    'mouseleave',
    function (e) {
      document.removeEventListener('mousemove', drag_move);

      if (wave.className !== '') {
        wave.className = '';
        setTimeout(function () {
          wavesurfer.Interacting &= ~(1 << 1);
        }, 20);
      }
    },
    false
  );
  wave.addEventListener(
    'mouseup',
    function (e) {
      if (e.which === 3) {
        if (wave.className !== '') {
          wave.className = '';
          setTimeout(function () {
            wavesurfer.Interacting &= ~(1 << 1);
          }, 20);
        }
        document.removeEventListener('mousemove', drag_move);
      }
    },
    false
  );

  app.fireEvent('RequestResize');

  app.listenFor('RequestViewFollowCursorToggle', function () {
    var val = !wavesurfer.FollowCursor;
    wavesurfer.FollowCursor = val;

    // jump to curr cursor position
    if (val && engine.is_ready) {
      wavesurfer.CursorCenter();
    }

    app.fireEvent('DidViewFollowCursorToggle', val);
  });
  app.listenFor('RequestViewPeakSeparatorToggle', function () {
    if (!engine.is_ready) return;

    var val = !wavesurfer.params.limits;
    wavesurfer.params.limits = val;

    wavesurfer.ForceDraw();

    app.fireEvent('DidViewPeakSeparatorToggle', val);
  });

  app.listenFor('RequestViewTimelineToggle', function () {
    if (!engine.is_ready) return;

    var val = !wavesurfer.params.timeline;
    wavesurfer.params.timeline = val;

    wavesurfer.ForceDraw();

    app.fireEvent('DidViewTimelineToggle', val);
  });

  app.listenFor('RequestViewCenterToCursor', function () {
    if (!engine.is_ready) return;
    wavesurfer.CursorCenter();
  });

  app.listenFor('RequestZoomUI', function (type, val) {
    if (!engine.is_ready) return;

    if (type === 0) {
      wavesurfer.ResetZoom();
      return;
    }

    if (type === 'h') {
      wavesurfer.SetZoom(0.5, val);
    }

    if (type === 'v') {
      wavesurfer.SetZoomVertical(val);
    }
  });
  // -

  this.ID3 = function (arraybuffer) {
    var tags = null;
    // var ttt = window.performance.now();

    var bytes = new Uint8Array(arraybuffer);
    if (bytes.length < 64) {
      app.fireEvent('RequestActionID3', 1, tags);
      return tags;
    }

    if (bytes[0] === 73 && bytes[1] === 68 && bytes[2] === 51) {
      tags = ID3v2.ReadTags(arraybuffer);

      //console.log( window.performance.now() - ttt );
      // console.log( tags );
    } else if (
      bytes[4] === 102 &&
      bytes[5] === 116 &&
      bytes[6] === 121 &&
      bytes[7] === 112 &&
      bytes[8] === 77 &&
      bytes[9] === 52
    ) {
      tags = ID4.ReadTags(arraybuffer);
      // console.log( window.performance.now() - ttt );
      // console.log( tags );
    }
    bytes = null;

    app.fireEvent('RequestActionID3', 1, tags);

    return tags;
  };
  // ---
}
