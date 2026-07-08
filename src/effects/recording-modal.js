/**
 * "New recording" dialog.
 *
 * Lets the user pick an input device and start a fresh recording when no
 * track is loaded yet (sample rate, channels, live level meter).
 */

import { AudioEffectModal } from '../ui/modals.js';

var modal_name = 'modalfx';
var modal_esc_key = modal_name + 'esc';

export function openRecordingModal(app) {
  var filter_id = 'rec_tools';

  var audio_stream = null;
  var audio_context = null;
  var script_processor = null;
  var media_stream_source = null;
  var temp_buffers = [];
  var newbuff = null;
  var sample_rate = 44100;
  var buffer_size = 2048; // * 2 ?
  var channel_num = 1;
  var channel_num_out = 1;

  var stop_audio = function () {
    if (!audio_stream) return;

    audio_stream.getTracks().forEach(function (stream) {
      stream.stop();
    });

    if (script_processor) {
      script_processor.onaudioprocess = null;
    }
    media_stream_source && media_stream_source.disconnect();
    script_processor && script_processor.disconnect();
    media_stream_source = null;
    audio_stream = null;
    audio_context = null;
  };

  var fxModal = AudioEffectModal(
    {
      id: filter_id,
      title: 'New Recording',

      ondestroy: function (q) {
        // destroy audio...
        stop_audio();

        temp_buffers = [];
        newbuff = null;

        app.ui.InteractionHandler.on = false;
        app.ui.KeyHandler.removeCallback(modal_esc_key);

        app.fireEvent('RequestStop');
      },

      body:
        '<div class="pk_rec" style="user-select:none">' +
        '<div class="pk_row">' +
        '<label>Devices:</label>' +
        '<select style="max-width:220px"></select>' +
        '</div>' +
        '<div class="pk_row">' +
        '<div style="float:left"><label>Volume</label>' +
        '<canvas width="200" height="40"></canvas></div>' +
        '<div style="float:left;margin-left:20px;"><label>Time</label>' +
        '<span style="font-size: 24px;line-height: 50px;">0.0</span></div>' +
        '<div style="clear:both;height:10px"></div>' +
        '<div><label>Waveform</label><canvas width="1000" height="200" style="image-rendering:pixelated;width:500px;height:100px;display:block;background:#000"></canvas></div>' +
        '</div>' +
        '<div class="pk_row">' +
        '<a class="pk_tbsa pk_inact" style="text-align: center;">START RECORDING</a>' +
        '<a class="pk_tbsa pk_inact" style="margin-left: 24px; text-align: center;">PAUSE</a>' +
        '</div>' +
        '<div class="pk_row">' +
        '<a class="pk_tbsa" style="float:left;display:none;text-align:center;box-shadow:0 0 7px #3a6b79 inset;">OPEN RECORDING</a>' +
        '<a class="pk_tbsa" style="float:left;display:none;margin-left: 24px; text-align: center;">APPEND TO EXISTING</a>' +
        '</div>' +
        '</div>',

      //			buttons: [{
      //				title:'Apply EQ',
      //				clss:'pk_modal_a_accpt',
      //				callback: function( q ) {
      //					q.Destroy ();
      //				}
      //			}],

      setup: function (q) {
        var is_ready = false;
        var is_active = false;
        var is_paused = false;
        var has_recorded = false;

        var mainbtns = q.el_body.getElementsByClassName('pk_tbsa');
        var btn_start = mainbtns[0];
        var btn_pause = mainbtns[1];
        var btn_open = mainbtns[2];
        var btn_add = mainbtns[3];
        var time_span = q.el_body.getElementsByTagName('span')[0];
        var devices_sel = q.el_body.getElementsByTagName('select')[0];
        var devices = [];
        var volcanvas = q.el_body.getElementsByTagName('canvas')[0];
        var volctx = volcanvas.getContext('2d', { alpha: false, antialias: false });

        var freqcanvas = q.el_body.getElementsByTagName('canvas')[1];
        var freqctx = freqcanvas.getContext('2d', { alpha: false, antialias: false });
        var tempCanvas = document.createElement('canvas');
        tempCanvas.width = 500 * 2;
        tempCanvas.height = 100 * 2;
        var tempCtx = tempCanvas.getContext('2d', { alpha: false, antialias: false });

        var first_skip = 12;
        var curr_offset = 0;
        var temp_buffer_index = -1;
        var volume = 0;
        var currtime = 0;
        var has_devices = false;

        var old_left_time = -999999;
        var old_right_time = -999999;
        var peaks = [];
        var skipp = false;
        var remaining = 0;
        var debounce = false;

        temp_buffers = [];
        newbuff = null;

        var draw_volume = function () {
          volctx.fillStyle = '#000';
          volctx.fillRect(0, 0, 200, 40);

          if (!is_active) {
            return;
          }

          volctx.fillStyle = 'green';
          volctx.fillRect(0, 0, volume * 200 * 1.67, 40);

          time_span.innerText = ((currtime * 10) >> 0) / 10;

          window.requestAnimationFrame(draw_volume);
        };

        var fetchBufferFunction = function (ev) {
          if (first_skip > 0) {
            --first_skip;
            return;
          }

          if (is_paused) {
            return;
          }

          curr_offset += ev.inputBuffer.duration * sample_rate;
          var float_array = ev.inputBuffer.getChannelData(0).slice(0);
          temp_buffers[++temp_buffer_index] = float_array;

          var sum = 0;
          var x;

          for (var i = 0; i < buffer_size; i += 2) {
            x = float_array[i];
            sum += x * x;
          }

          var rms = Math.sqrt(sum / (buffer_size / 2));
          volume = Math.max(rms, volume * 0.9);

          var curr_time = (temp_buffer_index * buffer_size) / sample_rate;
          currtime = curr_time;
          var width = 500;
          var height = 100;
          var half_height = (height / 2) * 2;
          var new_width = width;
          var cached_index = 0;
          var pixels = 0;
          var raw_pixels = 0;
          var limit = 3;

          var left_time = curr_time - limit;
          var right_time = curr_time; // + (limit/2);
          var quick_render = false;

          var start_offset = (left_time * sample_rate) >> 0;
          var end_offset = ((left_time + limit) * sample_rate) >> 0;
          var length = end_offset - start_offset;
          var mod = (length / width) >> 0;

          if (left_time < old_right_time) {
            // find pixels
            var diff = right_time - old_right_time;
            // pixels = Math.round ( (diff / limit) * width);

            raw_pixels = (diff / limit) * width;
            pixels = Math.round(raw_pixels);

            raw_pixels = ((raw_pixels * 1000) >> 0) / 1000;

            if (pixels >= 0) {
              if (pixels === 0) return;

              new_width = pixels;

              start_offset = (old_right_time * sample_rate) >> 0;
              end_offset = (right_time * sample_rate) >> 0;
              length = end_offset - start_offset;
              mod = (length / pixels) >> 0;

              peaks = peaks.slice(pixels * 2);
              cached_index = width - pixels;

              quick_render = true;
            }
          }

          old_right_time = right_time;

          var max = 0;
          var min = 0;

          for (var i = 0; i < new_width; ++i) {
            var new_offset = start_offset + mod * i;

            max = 0;
            min = 0;

            if (new_offset >= 0) {
              for (var j = 0; j < mod; j += 3) {
                var temp = new_offset + j;
                var temp2 = (temp / 2048) >> 0;
                var temp3 = temp % 2048;

                if (!temp_buffers[temp2]) continue;

                if (temp_buffers[temp2][temp3] > max) {
                  max = temp_buffers[temp2][temp3];
                } else if (temp_buffers[temp2][temp3] < min) {
                  min = temp_buffers[temp2][temp3];
                }
              }
            }

            peaks[2 * (i + cached_index)] = max;
            peaks[2 * (i + cached_index) + 1] = min;
          }

          if (quick_render) {
            // var imgdata = ctx.getImageData(0, 0, width, height);
            // tempCtx.putImageData (imgdata, 0, 0);
            tempCtx.drawImage(freqcanvas, 0, 0); //, width, height, 0, 0, width, height);
          }

          freqctx.fillStyle = '#000';
          // freqctx.clearRect( 0, 0, width, height );
          freqctx.fillRect(0, 0, width * 2, height * 2);
          freqctx.fillStyle = '#99c2c6';

          if (quick_render) {
            var forward = Math.round(raw_pixels * 2);
            remaining += forward - raw_pixels * 2;
            if (remaining > 1) {
              forward -= 1;
              remaining = 0;
            }

            // freqctx.translate(-1.5, 0);
            freqctx.translate(-forward, 0);
            freqctx.drawImage(tempCanvas, 0, 0); //, width, height, 0, 0, width, height);
            freqctx.setTransform(1, 0, 0, 1, 0, 0);

            //						freqctx.drawImage (tempCanvas, 0, 0, width, 100, -(raw_pixels.toFixed(1)/1), 0, width, 100);

            freqctx.beginPath();

            var peak = peaks[(width - pixels - 2) * 2];
            var _h = Math.round(peak * half_height);
            freqctx.moveTo((width - pixels - 2) * 2, half_height - _h);

            for (var i = width - pixels - 1; i < width; ++i) {
              peak = peaks[i * 2];
              _h = Math.round(peak * half_height);
              freqctx.lineTo(i * 2, half_height - _h);
            }

            for (var i = width - 1; i >= width - pixels - 1; --i) {
              var peak = peaks[i * 2 + 1];
              var _h = Math.round(peak * half_height);
              freqctx.lineTo(i * 2, half_height - _h);
            }

            freqctx.closePath();
            freqctx.fill();
          } else {
            freqctx.beginPath();
            freqctx.moveTo(0, half_height);

            for (var i = 0; i < width; ++i) {
              var peak = peaks[i * 2];
              var _h = Math.round(peak * half_height);
              freqctx.lineTo(i * 2, half_height - _h);
            }

            for (var i = width - 1; i >= 0; --i) {
              var peak = peaks[i * 2 + 1];
              var _h = Math.round(peak * half_height);
              freqctx.lineTo(i * 2, half_height - _h);
            }

            freqctx.closePath();
            freqctx.fill();
          }
        };

        navigator.mediaDevices
          .getUserMedia({ audio: true, video: false })
          .then(function (_stream) {
            _stream.getTracks().forEach(function (stream) {
              stream.stop();
            });

            enumerate();
          })
          .catch(function (error) {
            alert('no microphone permissions found!');
          });

        var enumerate = function () {
          if (navigator.mediaDevices.enumerateDevices) {
            navigator.mediaDevices.enumerateDevices().then((devices) => {
              devices = devices.filter((d) => d.kind === 'audioinput');
              has_devices = true;

              var len = devices.length;
              for (var i = 0; i < len; ++i) {
                var el = document.createElement('option');
                el.value = devices[i].deviceId;
                el.innerText = devices[i].label;
                devices_sel.appendChild(el);
              }

              is_ready = true;
              btn_start.classList.remove('pk_inact');
            });
          } else {
            devices_sel.parentNode.style.display = 'none';
            has_devices = false;
            is_ready = true;
            btn_start.classList.remove('pk_inact');
          }
        };

        var stop = function () {
          stop_audio();

          is_active = false;
          is_paused = false;
          first_skip = 10;

          ++temp_buffer_index;
          var k = -1;
          newbuff = new Float32Array(temp_buffer_index * buffer_size);
          for (var i = 0; i < temp_buffer_index; ++i) {
            for (var j = 0; j < buffer_size; ++j) {
              newbuff[++k] = temp_buffers[i][j];
            }
          }

          temp_buffer_index = -1;
          temp_buffers = [];

          // ------
          btn_open.style.display = 'block';

          // check to see if we are ready
          if (app.engine.is_ready) {
            btn_add.style.display = 'block';
          }

          has_recorded = true;
        };
        // ---

        btn_start.onclick = function () {
          if (!is_ready) return;

          if (debounce) {
            return;
          }

          debounce = true;
          setTimeout(function () {
            debounce = false;
          }, 260);

          // check if recording exists - ask for confirmation
          if (has_recorded) {
            if (!window.confirm('Are you sure? This will discard the current recording.')) {
              return;
            }
          }

          if (is_active) {
            stop();

            btn_pause.classList.add('pk_inact');
            btn_start.innerText = 'START RECORDING';
            btn_start.style.boxShadow = 'none';

            return;
          }

          temp_buffer_index = -1;
          temp_buffers = [];
          newbuff = null;
          volume = 0;

          btn_open.style.display = 'none';
          btn_add.style.display = 'none';

          audio_context = new (window.AudioContext || window.webkitAudioContext)();
          sample_rate = audio_context.sampleRate;

          var audio_val = true;
          if (has_devices) {
            audio_val = { deviceId: devices_sel.value };
            // devices_sel.options[devices_sel.selectedIndex].value;
          }

          navigator.mediaDevices
            .getUserMedia({ audio: audio_val })
            .then(function (stream) {
              audio_stream = stream;
              media_stream_source = audio_context.createMediaStreamSource(stream);

              script_processor = audio_context.createScriptProcessor(
                buffer_size,
                channel_num,
                channel_num_out
              );

              media_stream_source.connect(script_processor);
              script_processor.connect(audio_context.destination);

              is_active = true;
              btn_pause.classList.remove('pk_inact');
              btn_start.innerText = 'FINISH RECORDING';
              btn_start.style.boxShadow = '#992222 0px 0px 6px inset';
              script_processor.onaudioprocess = fetchBufferFunction;

              draw_volume();
            })
            .catch(function (error) {});
        };

        btn_pause.onclick = function () {
          if (!is_ready) return;
          if (!is_active) return;

          is_paused = !is_paused;

          btn_pause.innerText = is_paused ? 'UN-PAUSE' : 'PAUSE';
        };

        btn_open.onclick = function () {
          if (debounce) {
            return;
          }

          debounce = true;
          setTimeout(function () {
            debounce = false;
          }, 150);

          app.engine.wavesurfer.backend._add = 0;
          app.engine.LoadDB({
            samplerate: sample_rate,
            data: [newbuff.buffer],
          });

          // ----
          q.Destroy();
        };

        btn_add.onclick = function () {
          if (debounce) {
            return;
          }

          debounce = true;
          setTimeout(function () {
            debounce = false;
          }, 150);

          app.engine.wavesurfer.backend._add = 1;
          app.engine.LoadDB({
            samplerate: sample_rate,
            data: [newbuff.buffer],
          });

          // ----
          q.Destroy();
        };

        // ---
        app.fireEvent('RequestPause');
        app.ui.InteractionHandler.checkAndSet(modal_name);
        app.ui.KeyHandler.addCallback(
          modal_esc_key,
          function (e) {
            if (!app.ui.InteractionHandler.check(modal_name)) return;
            q.Destroy();
          },
          [27]
        );
      },
    },
    app
  );

  fxModal.Show();
}
