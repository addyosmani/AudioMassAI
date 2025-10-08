(function ( w, d ) {
	'use strict';

	var _v = '0.9',
		_id = -1;

	function PKAE () {
		var q = this; // keeping track of current context

		q.el = null; // reference of main html element
		q.id = ++_id; // auto incremental id
		q._deps = {}; // dependencies

		w.PKAudioList[q.id] = q;

		var events = {};

		q.fireEvent = function ( eventName, value, value2 ) {
			var group = events[eventName];
			if (!group) return (false);

			var l = group.length;
			while (l-- > 0) {
				group[l] && group[l] ( value, value2 );
			}
		};

		q.listenFor = function ( eventName, callback ) {
			if (!events[eventName])
				events[eventName] = [ callback ];
			else
				events[eventName].unshift ( callback  );
		};

		q.stopListeningFor = function ( eventName, callback ) {
			var group = events[eventName];
			if (!group) return (false);

			var l = group.length;
			while (l-- > 0) {
				if (group[l] && group[l] === callback) {
					group[l] = null; break;
				}
			}
		};

		q.stopListeningForName = function ( eventName ) {
			var group = events[eventName];
			if (!group) return (false);
			events[eventName] = null;
		};

		q.init = function ( el_id ) {
			var el = d.getElementById( el_id );
			if (!el) {
				console.log ('invalid element');
				return ;
			}
			q.el = el;

			// init libraries
			q.ui     = new q._deps.ui ( q ); q._deps.uifx ( q );
			q.engine = new q._deps.engine ( q );
			q.state  = new q._deps.state ( 4, q );
			q.rec    = new q._deps.rec ( q );
			q.fls    = new q._deps.fls ( q );

			// ninja focus touch <
			q.listenFor('RequestTranscription', async function () {
				const worker = new Worker('transcription.js?v=dev-1', {
					type: 'module'
				});
			
				const modal = new PKSimpleModal({
					title: 'Transcribing Audio...',
					clss: 'pk_modal_anim',
					body: '<p>Please wait, transcribing audio...</p><div class="pk_progress"><div class="pk_progress_bar"></div></div>',
					setup: function (modal_instance) {
						q.fireEvent('RequestPause');
						q.ui.InteractionHandler.checkAndSet('modal');
					}
				});
				modal.Show();
			
				worker.onmessage = (event) => {
					const { status, output, message, progress } = event.data;

					// console.log("ninja focus touch: output =>", output);
					// console.log("ninja focus touch: progress =>", progress);
					// console.log("ninja focus touch: status =>", status);
					// console.log("ninja focus touch: message =>", message);
			
					if (status === 'progress') {
						const progressBar = modal.el_body.querySelector('.pk_progress_bar');
						progressBar.style.width = `${progress}%`;
					} else if (status === 'complete') {
						modal.Destroy();
						new PKSimpleModal({
							title: 'Transcription',
							clss: 'pk_modal_anim',
							body: `<textarea readonly style="width: 100%; height: 200px;">${output.text}</textarea>`,
							buttons: [
								{
									title: 'Export',
									clss: 'pk_modal_a_accpt',
									callback: function (modal_instance) {
										const text = modal_instance.el_body.querySelector('textarea').value;
										const blob = new Blob([text], { type: 'text/plain' });
										const url = URL.createObjectURL(blob);
										const a = document.createElement('a');
										a.href = url;
										a.download = 'transcription.txt';
										document.body.appendChild(a);
										a.click();
										document.body.removeChild(a);
										URL.revokeObjectURL(url);
									}
								},
								{
									title: 'Close',
									clss: 'pk_modal_a_accpt',
									callback: function (modal_instance) {
										modal_instance.Destroy();
									}
								}
							],
							setup: function (modal_instance) {
								q.ui.InteractionHandler.checkAndSet('modal');
							}
						}).Show();
						worker.terminate();
					} else if (status === 'error') {
						modal.Destroy();
						q.fireEvent('ShowError', `Transcription failed: ${message}`);
						worker.terminate();
					}
				};
			
				// const audioBuffer = q.engine.wavesurfer.backend.buffer;
				// const audioData = {
				// 	audio: audioBuffer.getChannelData(0),
				// 	sampling_rate: audioBuffer.sampleRate,
				// };
				// worker.postMessage(audioData);
				const audioBuffer = q.engine.wavesurfer.backend.buffer;
				const { numberOfChannels, length, sampleRate } = audioBuffer;

				console.log("ninja focus touch: numberOfChannels =>", numberOfChannels);

				let mono = new Float32Array(length);
				if (numberOfChannels === 1) {
					mono.set(audioBuffer.getChannelData(0));
				} else {
					// average all channels
					for (let ch = 0; ch < numberOfChannels; ch++) {
						const chan = audioBuffer.getChannelData(ch);
						for (let i = 0; i < length; i++) {
							mono[i] += chan[i];
						}
					}
					for (let i = 0; i < length; i++) {
						mono[i] /= numberOfChannels;
					}
				}

				// optional normalization (helps with very quiet audio)
				/*
				let maxAmp = 0;
				for (let i = 0; i < mono.length; i++) maxAmp = Math.max(maxAmp, Math.abs(mono[i]));
				if (maxAmp > 0 && maxAmp < 0.1) {
					const gain = 0.5 / maxAmp; // keep headroom
					for (let i = 0; i < mono.length; i++) mono[i] *= gain;
				}
				*/

				// Resample to 16kHz for Whisper
				async function resampleTo16k(float32, fromRate) {
					const ctx = new OfflineAudioContext(1, Math.ceil(float32.length * 16000 / fromRate), 16000);
					const buffer = ctx.createBuffer(1, float32.length, fromRate);
					buffer.copyToChannel(float32, 0);
					const src = ctx.createBufferSource();
					src.buffer = buffer;
					src.connect(ctx.destination);
					src.start();
					const rendered = await ctx.startRendering();
					return rendered.getChannelData(0).slice();
				}
				
				const mono16k = await resampleTo16k(mono, sampleRate);
				worker.postMessage({ audio: mono16k, sampling_rate: 16000 }, [mono16k.buffer]);
			});
			// ninja focus touch >

			if (w.location.href.split('local=')[1]) {
				var sess = w.location.href.split('local=')[1];

				q.fls.Init (function () {
					q.fls.GetSession (sess, function ( e ) {
						if(e && e.id === sess )
						{
							q.engine.LoadDB ( e );
						}
					});
				});
			}

			return (q);
		};

		// check if we are mobile and hide tooltips on hover
		q.isMobile = (/iphone|ipod|ipad|android/).test
			(navigator.userAgent.toLowerCase ());
	};

	!w.PKAudioList && (w.PKAudioList = []);

	// ideally we do not want a global singleton referencing our audio tool
	// but since this is a limited demo we can safely do it.
	w.PKAudioEditor = new PKAE ();

	PKAudioList.push (w.PKAudioEditor); // keeping track in the audiolist array of our instance

})( window, document );
