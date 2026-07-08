/**
 * Tempo tools dialog.
 *
 * Beat/tempo analysis of the loaded track (onset detection over the raw
 * samples, grouped into rhythm candidates) with BPM readout and tap-tempo
 * style interaction.
 */

import { AudioEffectModal } from '../ui/modals.js';

var modal_name = 'modalfx';
var modal_esc_key = modal_name + 'esc';

///////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////
///////////////////////////////////////////////////////////////////////////////////////
function getOfflineAudioContext(channels, sampleRate, duration) {
  return new (window.OfflineAudioContext || window.webkitOfflineAudioContext)(
    channels,
    duration,
    sampleRate
  );
}
function _normalize_array(data) {
  var new_array = [];
  for (var i = 0; i < data.length; ++i) {
    new_array.push(Math.abs(Math.round((data[i + 1] - data[i]) * 1000)));
  }

  return new_array;
}

function _normalize_array2(data) {
  var new_array = [];
  for (var i = 0; i < data.length; ++i) {
    new_array.push(Math.round(Math.abs(data[i] * 1000)));
  }

  return new_array;
}

function _group_rhythm(data, diff_arr) {
  if (diff_arr.length <= 1) return;

  var peak_median = 0;
  for (var i = 0; i < data.length; ++i) {
    peak_median += data[i];
  }

  peak_median /= diff_arr.length;
  peak_median -= peak_median * 0.2;

  var diff_median = 0;
  for (var i = 0; i < diff_arr.length; ++i) {
    diff_median += diff_arr[i];
  }

  diff_median /= diff_arr.length;
  if (diff_median > 1) diff_median -= diff_median * 0.2;

  var existing = 0;
  for (var i = 0; i < diff_arr.length; ++i) {
    if (diff_arr[i] <= diff_median) continue;
    ++existing;
  }

  // console.log (" DIFF MEDIAN IS ", diff_median, "    and total beats: ", existing, "  out of: ", diff_arr.length);
  // clean-up the drums array - based on the median.
  // console.log ( JSON.stringify( data ) );
  // console.log ("----------");

  for (var i = 0, j = 0; i < data.length; ++i) {
    if (data[i] !== 0) {
      if (diff_arr[j] && diff_arr[j] < diff_median) {
        if (data[i] > peak_median && diff_arr[j] > diff_median * 0.6) {
          //console.log ( 'ZEROEDC NOOOOT ', i, '    ',  data[i], ' with median ', peak_median , '  but diff was  ', diff_arr[j],  '   yet. ',  diff_median );
        } else {
          //console.log ( 'ZEROEDC ', i, '    ',  data[i], ' with median ', peak_median , '  but diff was  ', diff_arr[j],  '   yet. ',  diff_median );
          data[i] = 0;
        }
      }

      ++j;
    }
    // ----
  }

  // console.log( data );
  window.final_arr = data;

  // console.log ( JSON.stringify( data ) );

  // now count distance between peaks
  var distances = {};
  var unique_distances = [];
  var first_found = 0;
  var is_first = true;
  for (var i = 0; i < data.length - 1; ++i) // #### do not litter the last data
  {
    if (data[i] === 0) {
      ++first_found;
      continue;
    }

    //if (first_found < 1 && !is_first) {
    //	continue;
    //}

    if (is_first) {
      is_first = false;
    }

    first_found = 0;

    var own = [];
    unique_distances.push(own);

    // console.log ('----------------------------------');
    // console.log ('COMPUTING DISTANCE OF ' + i + '    value ' + data[i] );

    var interval = 0;
    var total = 12;
    var last_found = 0;
    for (var j = i + 1; j < 1000; ++j) {
      if (data[j] === 0) {
        ++interval;
        ++last_found;
        continue;
      } else if (!data[j]) {
        break;
      }

      if (last_found < 0) {
        continue;
      }
      last_found = 0;

      if (--total === 0) break;

      own.push(interval);

      // if it exists, immediately reach out for the next one.
      if (!distances[interval]) distances[interval] = 0;
      distances[interval] += 1;

      // console.log ('distance with index ' + j + '    value ' + data[j] + '    is ' + interval );
    }
    // break;
  }

  console.log(unique_distances);

  // grab only the big peaks.

  function getmax(a) {
    var m = -Infinity,
      i = 0,
      n = a.length;

    for (; i != n; ++i) {
      if (a[i] > m) {
        m = a[i];
      }
    }
    return m;
  }

  function getmin(a) {
    var m = Infinity,
      i = 0,
      n = a.length;

    for (; i != n; ++i) {
      if (a[i] !== 0 && a[i] < m) {
        m = a[i];
      }
    }
    return m;
  }

  var max = getmax(data);
  var min = getmin(data);
  var count = 0;
  var threshold = Math.round((max - min) * 0.3);

  var velocities = [];
  for (var i = 0; i < data.length; ++i) {
    if (data[i] === 0) continue;

    if (data[i] >= max - threshold) {
      velocities.push(3);
    } else if (data[i] >= max - threshold * 2) {
      velocities.push(2);
    } else if (data[i] >= max - threshold * 3) {
      velocities.push(1);
    } else {
      velocities.push(0);
    }
  }

  return [distances, velocities];
}

export function openTempoTools(app) {
  app.fireEvent('RequestSelect', 1);
  var filter_id = 'tempo_tools';
  var act_index = 1;
  var act_tool = null;

  // ------
  var TempoMetro = function (app, modal) {
    var q = this;
    q.app = app;

    var bpm = 120;
    var tick = null;
    var count = 0;
    var time = ((60.0 / bpm) * 1000) >> 0;
    var audioContext = null; // new AudioContext();
    var osc = null;
    var amp = null;
    var ready = false;
    var volume = 0.5;
    var accentuate = true;

    var DidStopPlay = null;
    var DidPlay = null;
    var MetronomeAct = null;
    var MetronomeInAct = null;

    q.Init = function (container) {
      var q = this;

      q.el = container;

      _make_ui(q);
      _make_evs(q);
    };

    q.Destroy = function () {
      q.app.stopListeningFor('DidStopPlay', DidStopPlay);
      q.app.stopListeningFor('DidPlay', DidPlay);
      q.app.stopListeningFor('DidStartMetro', MetronomeAct);
      q.app.stopListeningFor('DidStopMetro', MetronomeInAct);

      DidStopPlay = null;
      DidPlay = null;
      MetronomeAct = null;
      MetronomeInAct = null;

      if (ready) {
        if (tick) {
          clearTimeout(tick);
          tick = null;
        }

        if (audioContext) {
          var now = audioContext.currentTime;
          osc.stop(now);

          amp.disconnect();
          osc.disconnect();

          audioContext = null;

          ready = false;
        }
      }

      if (q.body) {
        q.body.parentNode.removeChild(q.body);
        q.body = null;
      }

      q.app = null;
    };

    function _make_ui(q) {
      var el_drawer = document.createElement('div');
      el_drawer.className = 'pk_row';

      el_drawer.innerHTML =
        '<div class="pk_row">' +
        '<label>BPM</label>' +
        '<input type="range" min="20" max="300" class="pk_horiz" step="1" value="120" />' +
        '<span class="pk_val">120</span>' +
        '</div>' +
        '<div class="pk_row">' +
        '<label>Volume</label>' +
        '<input type="range" min="0.0" max="1.0" class="pk_horiz" step="0.1" value="0.5" />' +
        '<span class="pk_val">50%</span>' +
        '</div>' +
        '<div class="pk_row">' +
        '<input type="checkbox" id="xxcjgs" class="pk_check" checked name="metroAccent">' +
        '<label for="xxcjgs">Accentuate metronome click</label></div>' +
        '<div class="pk_row">' +
        '<a class="pk_modal_a_bottom" style="display:inline-block;float:none">Metronome</a>' +
        '<a class="pk_modal_a_bottom" style="display:inline-block;float:none">Play Track</a>' +
        '<a class="pk_modal_a_bottom" style="display:inline-block;float:none">Play Both</a>' +
        '</div>';

      q.body = el_drawer;
      q.el.appendChild(el_drawer);
    }

    function _make_evs(q) {
      var range = q.body.getElementsByClassName('pk_horiz')[0];
      var span = q.body.getElementsByClassName('pk_val')[0];

      var range2 = q.body.getElementsByClassName('pk_horiz')[1];
      var span2 = q.body.getElementsByClassName('pk_val')[1];

      var checkbox = q.body.getElementsByClassName('pk_check')[0];

      range.oninput = function () {
        bpm = range.value / 1;
        span.innerHTML = bpm;

        time = ((60.0 / bpm) * 1000) >> 0;
      };

      range2.oninput = function () {
        var val = range2.value / 1;
        volume = val;

        span2.innerHTML = ((val * 100) >> 0) + '%';
      };

      checkbox.oninput = function () {
        accentuate = checkbox.checked;
      };

      var metronome_btn = q.body.getElementsByClassName('pk_modal_a_bottom')[0];
      var play_btn = q.body.getElementsByClassName('pk_modal_a_bottom')[1];
      var both_btn = q.body.getElementsByClassName('pk_modal_a_bottom')[2];

      metronome_btn.onclick = function () {
        if (tick) {
          clearTimeout(tick);
          tick = null;
          count = 0;

          q.app.fireEvent('DidStopMetro');
          return;
        }

        var play = function () {
          tick = setTimeout(function () {
            if (!tick) return;

            if (++count % 4 === 0) _metronome(1);
            else _metronome(0);

            play();
          }, time);
        };

        count = 0;
        if (!ready) _prepare();

        q.app.fireEvent('DidStartMetro');

        _metronome(1);
        play();
      };

      MetronomeInAct = function () {
        metronome_btn.classList.remove('pk_act');
      };
      MetronomeAct = function () {
        metronome_btn.classList.add('pk_act');
      };
      q.app.listenFor('DidStartMetro', MetronomeAct);
      q.app.listenFor('DidStopMetro', MetronomeInAct);

      play_btn.onclick = function () {
        if (app.engine.wavesurfer.isPlaying()) {
          q.app.fireEvent('RequestStop');
        } else {
          q.app.fireEvent('RequestPlay');
        }
      };
      if (!app.engine.wavesurfer.isReady) {
        play_btn.className += ' pk_inact';
        both_btn.className += ' pk_inact';
      }

      if (app.engine.wavesurfer.isPlaying()) {
        play_btn.className += ' pk_act';
      }

      DidStopPlay = function () {
        play_btn.classList.remove('pk_act');
        play_btn.innerText = 'Play Track';
      };
      DidPlay = function () {
        play_btn.classList.add('pk_act');
        play_btn.innerText = 'Stop Track';
      };
      q.app.listenFor('DidStopPlay', DidStopPlay);
      q.app.listenFor('DidPlay', DidPlay);

      both_btn.onclick = function () {
        if (tick) metronome_btn.onclick();
        if (app.engine.wavesurfer.isPlaying()) play_btn.onclick();

        setTimeout(function () {
          if (!tick && !app.engine.wavesurfer.isPlaying()) {
            play_btn.onclick();
            setTimeout(function () {
              metronome_btn.onclick();
            }, 0);
          }
        }, 66);
      };
    }

    function _metronome(type) {
      if (type === 1 && accentuate) {
        osc.frequency.value = 880.0;
      } else {
        osc.frequency.value = 440.0;
      }

      amp.gain.setValueAtTime(amp.gain.value, audioContext.currentTime);
      amp.gain.linearRampToValueAtTime(volume, audioContext.currentTime + 0.01);
      amp.gain.linearRampToValueAtTime(0.0, audioContext.currentTime + 0.12);
    }

    function _prepare() {
      audioContext = new (window.AudioContext || window.webkitAudioContext)();

      osc = audioContext.createOscillator();
      amp = audioContext.createGain();
      amp.gain.value = 0;

      osc.connect(amp);
      amp.connect(audioContext.destination);

      osc.start(0);

      ready = true;
      // osc.stop( time + 0.05 );
    }
  };

  var TempoTap = function (app, modal) {
    var q = this;
    q.app = app;

    var DidStopPlay = null;
    var DidPlay = null;
    var DidSetLoop = null;
    var DidAudioProcess = null;

    q.Init = function (container) {
      var q = this;

      q.el = container;

      _make_ui(q);
      _make_evs(q);
    };

    q.Destroy = function () {
      q.app.stopListeningFor('DidStopPlay', DidStopPlay);
      q.app.stopListeningFor('DidPlay', DidPlay);
      q.app.stopListeningFor('DidSetLoop', DidSetLoop);
      q.app.stopListeningFor('DidAudioProcess', DidAudioProcess);

      DidStopPlay = null;
      DidPlay = null;
      DidSetLoop = null;
      DidAudioProcess = null;

      q.app.ui.KeyHandler.removeCallback('tmpTap');

      if (q.body) {
        q.body.parentNode.removeChild(q.body);
        q.body = null;
      }

      q.app = null;
    };

    function _make_ui(q) {
      var el_drawer = document.createElement('div');
      el_drawer.className = 'pk_row';

      // Estimate tempo for selected area button
      el_drawer.innerHTML =
        '<div class="pk_row pk_pgeq_els">' +
        '<span>Average BPM</span>' +
        '<input style="margin-left:2px;min-width:64px;max-width:64px" ' +
        'type="text" class="pk_val pk_gain" value="-">' +
        '</div>' +
        '<div class="pk_row pk_pgeq_els">' +
        '<span>Nearest BPM</span>' +
        '<input style="margin-left:2px;min-width:64px;max-width:64px" ' +
        'type="text" class="pk_val pk_gain" value="-">' +
        '</div>' +
        '<div class="pk_row pk_pgeq_els">' +
        '<span>Timing Taps</span>' +
        '<input style="margin-left:2px;min-width:64px;max-width:64px" ' +
        'type="text" class="pk_val pk_gain" value="-">' +
        '<a class="pk_modal_a_bottom" style="display:inline-block;float:none">Reset</a>' +
        '<a class="pk_modal_a_bottom" style="display:inline-block;float:none">Play Track</a>' +
        '<a class="pk_modal_a_bottom" style="display:inline-block;float:none">Loop</a>' +
        '</div>' +
        '<div><div id="pk_tmp_tap">' +
        '<span style="opacity:0" class="pk_obj2">CLEARED...</span>' +
        '<span class="pk_obj2">STAND BY...</span>' +
        '</div>' +
        '<div id="pk_tmp_tap2" style="position:relative">' +
        '<canvas width="1000" height="200" style="image-rendering:pixelated;width:500px;height:100px;display:block;background:#000"></canvas>' +
        '<span style="z-index:3;background:red;position:absolute;display:block;width:2px;height:100px;' +
        'left:50%;margin-left:-1px;top:0"></span>' +
        '</div></div>' +
        '<div id="pk_tmp_tap3">' +
        '<span style="position:absolute;top:50%;display:block;width:80%;left:10%;font-size:12px;' +
        'margin-top:-20px;user-select:none;text-align:center;pointer-events:none;color:#ccc">' +
        'Tap in this area, or hit [SPACE] rhythmically, to measure BPM.' +
        '</span>' +
        '</div>';

      q.body = el_drawer;
      q.el.appendChild(el_drawer);
    }

    function _make_evs(q) {
      var tap_graph = q.body.querySelectorAll('#pk_tmp_tap')[0];
      var tap_area = q.body.querySelectorAll('#pk_tmp_tap3')[0];
      var reset_btn = q.body.getElementsByClassName('pk_modal_a_bottom')[0];
      var play_btn = q.body.getElementsByClassName('pk_modal_a_bottom')[1];
      var loop_btn = q.body.getElementsByClassName('pk_modal_a_bottom')[2];

      var canvas = q.body.getElementsByTagName('canvas')[0];
      var ctx = canvas.getContext('2d', { alpha: false, antialias: false });

      var tempCanvas = document.createElement('canvas');
      tempCanvas.width = 500 * 2;
      tempCanvas.height = 100 * 2;
      var tempCtx = tempCanvas.getContext('2d', { alpha: false, antialias: false });

      ctx.imageSmoothingEnabled = true;
      tempCtx.imageSmoothingEnabled = true;

      var value_els = q.body.getElementsByClassName('pk_val');
      var tap_msg = tap_graph.getElementsByClassName('pk_obj2');
      var tap_msg2 = tap_area.getElementsByTagName('span')[0];

      var bpm_el = value_els[0];
      var bpm_el_round = value_els[1];
      var bpm_el_count = value_els[2];
      var reset_wait = 3000;

      var time_msec = 0;
      var time_msec_prev = 0;
      var time_msec_first = 0;
      var count = 0;
      var bpm = 0;
      var steps_count = 0;
      var first = true;
      var is_playing = false;

      var _reset_count = function (force) {
        if (first) {
          tap_msg[1].style.opacity = '0';
        }

        count = 0;
        steps_count = 0;
        first = true;

        setTimeout(
          function () {
            if (!first) return;

            tap_msg[0].style.opacity = '0.5';
            if (!force) {
              reset_btn.className += ' pk_act';
              setTimeout(function () {
                reset_btn.classList.remove('pk_act');
              }, 140);
            }

            setTimeout(
              function () {
                if (first) {
                  tap_msg[0].style.opacity = '0';
                  tap_msg[1].style.opacity = '0.5';
                } else {
                  tap_msg[0].style.opacity = '0';
                  tap_msg[1].style.opacity = '0';
                }
              },
              force ? 490 : 874
            );
          },
          force ? 0 : 150
        );

        if (force) {
          bpm_el.value = '-';
          bpm_el_round.value = '-';
          bpm_el_count.value = '-';

          var els = tap_graph.parentNode.getElementsByClassName('pk_obj');
          var l = els.length;

          while (l-- > 0) {
            if (els[l]) {
              els[l].parentNode.removeChild(els[l]);
            }
          }
        }
      };

      reset_btn.onclick = function () {
        _reset_count(true);
      };

      play_btn.onclick = function () {
        if (app.engine.wavesurfer.isPlaying()) {
          q.app.fireEvent('RequestStop');
        } else {
          q.app.fireEvent('RequestPlay');
        }
      };

      if (!app.engine.wavesurfer.isReady) {
        play_btn.className += ' pk_inact';
        loop_btn.className += ' pk_inact';
      }
      if (app.engine.wavesurfer.isPlaying()) {
        play_btn.className += ' pk_act';
      }

      DidStopPlay = function () {
        is_playing = false;
        play_btn.classList.remove('pk_act');
        play_btn.innerText = 'Play Track';
      };
      DidPlay = function () {
        is_playing = true;
        play_btn.classList.add('pk_act');
        play_btn.innerText = 'Stop Track';
      };

      q.app.listenFor('DidStopPlay', DidStopPlay);
      q.app.listenFor('DidPlay', DidPlay);

      var old_left_time = -999999;
      var old_right_time = -999999;
      var peaks = [];
      var skipp = false;
      var remaining = 0;

      DidAudioProcess = function () {
        //if (skipp) {
        //	skipp = false;
        //	return ;
        //}
        //skipp = true;

        var wv = app.engine.wavesurfer;
        var buffer = wv.backend.buffer;
        var chan_data = buffer.getChannelData(0);
        var sample_rate = buffer.sampleRate;

        var curr_time = wv.getCurrentTime();
        var width = 500;
        var height = 100;
        var half_height = (height / 2) * 2;
        var new_width = width;
        var cached_index = 0;
        var pixels = 0;
        var raw_pixels = 0;
        var limit = 3;

        var left_time = curr_time - limit / 2;
        var right_time = curr_time + limit / 2;
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
              if (chan_data[new_offset + j] > max) {
                max = chan_data[new_offset + j];
              } else if (chan_data[new_offset + j] < min) {
                min = chan_data[new_offset + j];
              }
            }
          }

          peaks[2 * (i + cached_index)] = max;
          peaks[2 * (i + cached_index) + 1] = min;
        }

        if (quick_render) {
          // var imgdata = ctx.getImageData(0, 0, width, height);
          // tempCtx.putImageData (imgdata, 0, 0);
          tempCtx.drawImage(canvas, 0, 0); //, width, height, 0, 0, width, height);
        }

        ctx.fillStyle = '#000';
        // ctx.clearRect( 0, 0, width, height );
        ctx.fillRect(0, 0, width * 2, height * 2);
        ctx.fillStyle = '#99c2c6';

        if (quick_render) {
          var forward = Math.round(raw_pixels * 2);
          remaining += forward - raw_pixels * 2;
          if (remaining > 1) {
            forward -= 1;
            remaining = 0;
          }

          // ctx.translate(-1.5, 0);
          ctx.translate(-forward, 0);
          ctx.drawImage(tempCanvas, 0, 0); //, width, height, 0, 0, width, height);
          ctx.setTransform(1, 0, 0, 1, 0, 0);

          //						ctx.drawImage (tempCanvas, 0, 0, width, 100, -(raw_pixels.toFixed(1)/1), 0, width, 100);

          ctx.beginPath();

          var peak = peaks[(width - pixels - 2) * 2];
          var _h = Math.round(peak * half_height);
          ctx.moveTo((width - pixels - 2) * 2, half_height - _h);

          for (var i = width - pixels - 1; i < width; ++i) {
            peak = peaks[i * 2];
            _h = Math.round(peak * half_height);
            ctx.lineTo(i * 2, half_height - _h);
          }

          for (var i = width - 1; i >= width - pixels - 1; --i) {
            var peak = peaks[i * 2 + 1];
            var _h = Math.round(peak * half_height);
            ctx.lineTo(i * 2, half_height - _h);
          }

          ctx.closePath();
          ctx.fill();
        } else {
          ctx.beginPath();
          ctx.moveTo(0, half_height);

          for (var i = 0; i < width; ++i) {
            var peak = peaks[i * 2];
            var _h = Math.round(peak * half_height);
            ctx.lineTo(i * 2, half_height - _h);
          }

          for (var i = width - 1; i >= 0; --i) {
            var peak = peaks[i * 2 + 1];
            var _h = Math.round(peak * half_height);
            ctx.lineTo(i * 2, half_height - _h);
          }

          ctx.closePath();
          ctx.fill();
        }

        //console.log( peaks );
      };

      q.app.listenFor('DidAudioProcess', DidAudioProcess);

      if (app.engine.wavesurfer.regions.list[0]) {
        if (app.engine.wavesurfer.regions.list[0].loop) loop_btn.className += ' pk_act';
      }
      loop_btn.onclick = function () {
        q.app.fireEvent('RequestSetLoop');
      };

      DidSetLoop = function (val) {
        val ? loop_btn.classList.add('pk_act') : loop_btn.classList.remove('pk_act');
      };
      q.app.listenFor('DidSetLoop', DidSetLoop);

      tap_graph.parentNode.addEventListener('transitionend', function (e) {
        if (!tap_graph) return;

        var el = e.target;
        if (el.tagName !== 'DIV') return;

        el.parentNode.removeChild(el);
        --steps_count;

        if (steps_count === 0) {
          if (is_playing)
            setTimeout(function () {
              if (steps_count === 0) _reset_count();
            }, 1100);
          else _reset_count();
        }
      });

      tap_area.onclick = function (ev) {
        if (ev) {
          ev.preventDefault();
          ev.stopPropagation();
        }

        if (first) {
          first = false;
          tap_msg[1].style.opacity = '0';
        }

        time_msec = Date.now();

        if (time_msec - time_msec_prev > reset_wait) {
          count = 0;
        }

        if (count === 0) {
          time_msec_first = time_msec;
          count = 1;

          bpm_el.value = 'First Beat';
          bpm_el_round.value = 'First Beat';
          bpm_el_count.value = count;
        } else {
          bpm = (60000 * count) / (time_msec - time_msec_first);
          ++count;

          bpm_el.value = Math.round(bpm * 100) / 100;
          bpm_el_round.value = Math.round(bpm);
          bpm_el_count.value = count;
        }

        var step = document.createElement('div');
        step.className = 'pk_obj';

        if (is_playing) {
          canvas.parentNode.appendChild(step);
        } else {
          tap_graph.appendChild(step);
        }
        ++steps_count;

        tap_area.classList.add('pk_act');

        requestAnimationFrame(function () {
          step.style.transform = 'translate3d(-10%,0,0)';

          setTimeout(function () {
            tap_area.classList.remove('pk_act');
          }, 56);
        });

        time_msec_prev = time_msec;
      };

      app.ui.KeyHandler.addCallback(
        'tmpTap',
        function (e, o, ev) {
          if (!app.ui.InteractionHandler.check(modal_name)) return;

          ev.preventDefault();
          ev.stopPropagation();

          tap_area.onclick(null);
        },
        [32]
      );

      // ---
    }
  };

  // events
  var TempoEstimation = function (app, modal) {
    var q = this;
    q.app = app;

    q.Init = function (container) {
      var q = this;

      q.el = container;

      _make_ui(q);
      _make_evs(q);
    };

    q.Destroy = function () {
      if (q.body) {
        q.body.parentNode.removeChild(q.body);
        q.body = null;
      }

      q.app = null;
    };

    q.Est = function (selection) {
      var q = this;

      var wavesurfer = q.app.engine.wavesurfer;
      var buffer = wavesurfer.backend.buffer;

      var starting_time = 20.375;
      var ending_time = wavesurfer.getDuration();
      var sample_rate = buffer.sampleRate;

      var look_ahead = 10 * sample_rate;
      var offset_rate = starting_time * sample_rate;
      var duration_rate = ending_time * sample_rate;
      var dist_rhythm = {};

      // now run offline
      var audio_ctx = getOfflineAudioContext(1, buffer.sampleRate, buffer.length);

      var source = audio_ctx.createBufferSource();
      source.buffer = buffer;

      var filter = audio_ctx.createBiquadFilter();
      filter.type = 'highpass';
      filter.frequency.value = 50;
      filter.Q.value = 1.1;
      source.connect(filter);

      var filter2 = audio_ctx.createBiquadFilter();
      filter2.type = 'lowpass';
      filter2.frequency.value = 140;
      filter2.Q.value = 2.5;
      filter.connect(filter2);
      filter2.connect(audio_ctx.destination);

      source.start(0);

      var offline_callback = function (rendered_buffer) {
        _pass(rendered_buffer, offset_rate, duration_rate);
      };

      var _pass = function (rendered_buffer, offset, duration) {
        var chan_data = rendered_buffer.getChannelData(0);
        var new_arr = [];
        var diff_arr = [];
        var currval = 0;
        var prev_val = 0;
        var bottom = 100000;
        var top = -100000;
        var found_pick = false;
        var going_up = false;
        var peak_dist = 0;
        var peak_prev = 0;
        var next_offset = offset + look_ahead;

        var trimmed_arr = [];
        var modulus_coefficient = Math.round(look_ahead / 200);
        var plus_one = look_ahead + modulus_coefficient;

        for (var i = 0; i < plus_one; ++i) {
          if (i % modulus_coefficient === 0) {
            // look into 50 neighboring entries for higher values.
            var val_clean = chan_data[offset + i];
            var val = Math.abs(val_clean);

            //console.log( "was ", val_clean );

            var tmp_val = 0;
            for (var uu = 1; uu < 50; ++uu) {
              tmp_val = Math.abs(chan_data[offset + i - uu]);

              if (tmp_val > val) {
                val_clean = chan_data[offset + i - uu];
                val = Math.abs(val_clean);
              }
            }

            for (var uu = 1; uu < 50; ++uu) {
              tmp_val = Math.abs(chan_data[offset + i + uu]);

              if (tmp_val > val) {
                val_clean = chan_data[offset + i + uu];
                val = Math.abs(val_clean);
              }
            }

            //console.log( "added ", val_clean );
            //console.log("-----");

            trimmed_arr.push(val_clean);
          }
        }

        trimmed_arr = _normalize_array2(trimmed_arr);
        trimmed_arr.pop();

        // ------------
        prev_val = trimmed_arr[0];
        for (var j = 1; j < trimmed_arr.length; ++j) {
          currval = trimmed_arr[j];

          if (currval > prev_val) {
            if (!going_up) {
              if (bottom > prev_val) {
                bottom = prev_val;
                top = -100000;
              }
            }

            going_up = true;
          } else if (currval < prev_val) {
            if (going_up) {
              // console.log (":: peak: ", prev_val.toFixed(2)/1, "  bottom: ", bottom.toFixed(2)/1, "  diff: ", Math.abs(prev_val-bottom).toFixed(2)/1 );

              found_pick = true;

              if (peak_dist < 3 && Math.abs(new_arr[peak_prev] - prev_val) < 150) {
                // debugger;

                if (prev_val > new_arr[peak_prev]) {
                  new_arr[peak_prev] = 0;
                  diff_arr.pop();
                } else {
                  found_pick = false;
                }
              }

              if (found_pick) {
                diff_arr.push(Math.abs(prev_val - bottom));

                peak_dist = 0;
                new_arr.push(prev_val);

                peak_prev = new_arr.length - 1;

                if (prev_val > top) {
                  top = prev_val;
                  bottom = 100000;
                }
              }
              // -----
            }

            going_up = false;
          }

          prev_val = currval;

          if (!found_pick) {
            new_arr.push(0);
            //console.log( "ZEROED ", new_arr.length - 1 );
            ++peak_dist;
          } else {
            found_pick = false;
          }
        }

        // console.log( trimmed_arr );
        // console.log( new_arr );
        // window.trimmed_arr = trimmed_arr;
        // window.new_arr = new_arr;
        // window.chan = chan_data;

        // ----
        var ret = _group_rhythm(new_arr, diff_arr);
        if (!ret) {
          console.log('something weird happened, error 244');
          return;
        }

        var distances = ret[0];

        // console.log( diff_arr );
        // console.log( ret[1] );

        for (var k in distances) {
          if (!dist_rhythm[k]) dist_rhythm[k] = 0;

          dist_rhythm[k] += distances[k];
        }

        console.log(distances);
        // console.log( ' ---------------- ' );
        // console.log ('--------- END OF PASS -------  ',  offset, ' / ', duration);

        if (next_offset + look_ahead >= duration) {
          // Done...
          console.log(dist_rhythm);
        } else {
          // 	_pass ( rendered_buffer, next_offset, duration );
        }
        // ----
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
    };

    function _make_ui(q) {
      var el_drawer = document.createElement('div');
      el_drawer.className = 'pk_row';

      // Estimate tempo for selected area button
      el_drawer.innerHTML =
        '<div class="pk_row">' +
        '<input type="radio" class="pk_check" id="tt4" name="xport" checked value="whole">' +
        '<label for="tt4">Whole track</label>' +
        '<input type="radio" class="pk_check" id="tt5" name="xport" value="sel">' +
        '<label class="pk_lblmp3" for="tt5">Estimate for Selection Only</label></div>' +
        '<div class="pk_row">' +
        '<a class="pk_modal_a_bottom" style="margin:0;float:left">Estimate</a>' +
        '</div>';

      q.body = el_drawer;
      q.el.appendChild(el_drawer);
    }

    function _make_evs(q) {
      var btn_est = q.body.getElementsByTagName('a')[0];
      if (!btn_est) return;

      btn_est.onclick = function () {
        q.Est && q.Est(1);
        // q.app && q.app.fireEvent ('ReqEst', 1);
      };
    }
  };

  var fxModal = AudioEffectModal(
    {
      id: filter_id,
      title: 'Tempo & Rhythm Tools',

      ondestroy: function (q) {
        app.ui.InteractionHandler.on = false;
        app.ui.KeyHandler.removeCallback(modal_esc_key);
        act_tool.Destroy();
        act_tool = null;

        app.fireEvent('RequestStop');
      },

      body:
        '<div class="pk_tbs">' +
        '<a class="pk_tbsa pk_inact">Tempo Estimation</a>' +
        '<a class="pk_tbsa">Tempo Tap</a>' +
        '<a class="pk_tbsa">Metronome</a></div>',

      //			buttons: [{
      //				title:'Apply EQ',
      //				clss:'pk_modal_a_accpt',
      //				callback: function( q ) {
      //					q.Destroy ();
      //				}
      //			}],

      setup: function (q) {
        var toplinks = q.el_body.getElementsByClassName('pk_tbsa');

        var destroy = function () {
          if (act_tool) {
            act_tool.Destroy();
            act_tool = null;
            toplinks[act_index].classList.remove('pk_act');
          }
        };

        var activate = function () {
          // get the active state
          if (act_index === 0) {
            // toplinks[0].className += ' pk_act';
            // act_tool = new TempoEstimation ( app, q );
            return;
          } else if (act_index === 1) {
            toplinks[1].className += ' pk_act';
            act_tool = new TempoTap(app, q);
          } else if (act_index === 2) {
            toplinks[2].className += ' pk_act';
            act_tool = new TempoMetro(app, q);
          }

          act_tool && act_tool.Init(q.el_body);
        };

        //toplinks[0].onclick = function() {
        //	destroy ();
        //	act_index = 0;
        //	activate ();
        //};
        toplinks[1].onclick = function () {
          if (act_index === 1) return;

          destroy();
          act_index = 1;
          activate();
        };
        toplinks[2].onclick = function () {
          if (act_index === 2) return;

          destroy();
          act_index = 2;
          activate();
        };

        activate();

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
  // ------
}
