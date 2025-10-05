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

			q.listenFor('RequestTranscription', function () {
				const worker = new Worker('transcription.js', {
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
			
					if (status === 'progress') {
						const progressBar = modal.el_body.querySelector('.pk_progress_bar');
						progressBar.style.width = `${progress}%`;
					} else if (status === 'complete') {
						modal.Destroy();
						new PKSimpleModal({
							title: 'Transcription',
							clss: 'pk_modal_anim',
							body: `<textarea readonly style="width: 100%; height: 200px;">${output.text}</textarea>`,
							buttons: [{
								title: 'Close',
								clss: 'pk_modal_a_accpt',
								callback: function (modal_instance) {
									modal_instance.Destroy();
								}
							}],
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
			
				const audioBuffer = q.engine.wavesurfer.backend.buffer;
				const channelData = audioBuffer.getChannelData(0);
				worker.postMessage({ audio: channelData });
			});

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

	// ideally we do not want a global singleto refferencing our audio tool
	// but since this is a limited demo we can safely do it.
	w.PKAudioEditor = new PKAE ();

	PKAudioList.push (w.PKAudioEditor); // keeping track in the audiolist array of our instance

})( window, document );
