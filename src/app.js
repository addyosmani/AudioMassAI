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

			q.listenFor('RequestTranscription', async function () {
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
						
						// ninja focus touch <
						// Fallback summarization function for when Chrome Summarizer API is not available or failed
						function fallbackSummarization(modal_instance, originalText, button, textarea) {
							// Placeholder for alternative AI model implementation
							// TODO: Implement fallback summarization logic
							console.log('ninja focus touch: Using fallback summarization - placeholder');
							
							// Simulate processing delay
							setTimeout(() => {
								const placeholderSummary = `[SUMMARY - Placeholder]\n\nThis is a placeholder summary. The actual summarization logic will be implemented here when Chrome's built-in Summarizer API is not available.\n\nOriginal text length: ${originalText.length} characters\n\n[End of placeholder summary]`;
								
								// Update UI
								textarea.value = placeholderSummary;
								button.innerHTML = 'Undo';
								button.title = 'Undo';
								button.disabled = false;
							}, 1000);
						}
						// ninja focus touch >
						
						new PKSimpleModal({
							title: 'Transcription',
							clss: 'pk_modal_anim',
							body: `<textarea readonly style="width: 100%; height: 200px;">${output.text}</textarea>`,
							ondestroy: function (modal_instance) {
								q.ui.InteractionHandler.on = false;
								q.ui.KeyHandler.removeCallback('modalTemp');
							},
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
								// ninja focus touch <
								{
									title: 'Summarize',
									clss: 'pk_modal_a_accpt',
									callback: function (modal_instance) {
										// Get the Summarize button from the modal's bottom buttons array
										// Export is at index 0, Summarize is at index 1, Close is at index 2
										const button = modal_instance.els.bottom[1];
										const textarea = modal_instance.el_body.querySelector('textarea');
										const currentText = textarea.value;

										// Check if we're in "Undo" mode (showing summary)
										if (button.innerHTML === 'Undo') {
											// Restore original transcript
											textarea.value = modal_instance._originalTranscript;
											button.innerHTML = 'Summarize';
											button.title = 'Summarize';
											return;
										}
										
										// Store original transcript for undo functionality
										modal_instance._originalTranscript = currentText;
										
										// Show loading state
										button.innerHTML = 'Summarizing...';
										button.disabled = true;
										
										// Try Chrome's built-in Summarizer API first
										if (typeof window !== 'undefined' && 'Summarizer' in window) {
											try {
												// Check if user activation is required and available
												if (!navigator.userActivation.isActive) {
													console.warn('User activation required for Summarizer API');
													fallbackSummarization(modal_instance, currentText, button, textarea);
													return;
												}

												// Use Chrome's on-device Summarizer API
												(async () => {
													try {
														// Check availability first
														const availability = await Summarizer.availability();
														if (availability === 'unavailable') {
															console.warn('Summarizer API unavailable');
															fallbackSummarization(modal_instance, currentText, button, textarea);
															return;
														}

														// Create summarizer with default options
														const summarizer = await Summarizer.create({
															type: 'key-points',
															format: 'markdown',
															length: 'medium'
														});

														// Generate summary
														const summary = await summarizer.summarize(currentText);
														
														// Update UI with summary
														textarea.value = summary;
														button.innerHTML = 'Undo';
														button.title = 'Undo';
														button.disabled = false;
													} catch (error) {
														console.warn('Chrome Summarizer API failed:', error);
														// Fall back
														fallbackSummarization(modal_instance, currentText, button, textarea);
													}
												})();
											} catch (error) {
												console.warn('Chrome Summarizer API not available:', error);
												// Fall back
												fallbackSummarization(modal_instance, currentText, button, textarea);
											}
										} else {
											console.warn('Chrome Summarizer API not available');
											// Chrome Summarizer API not available, use fallback
											fallbackSummarization(modal_instance, currentText, button, textarea);
										}
									}
								},
								// ninja focus touch >
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
								q.ui.KeyHandler.addCallback('modalTemp', function (e) {
									modal_instance.Destroy();
								}, [27]);
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
				const { numberOfChannels, length, sampleRate } = audioBuffer;

				let mono = new Float32Array(length);
				if (numberOfChannels === 1) {
					mono.set(audioBuffer.getChannelData(0));
				} else {
					// Average all channels
					for (let channel = 0; channel < numberOfChannels; channel++) {
						const channelData = audioBuffer.getChannelData(channel);
						for (let index = 0; index < length; index++) {
							mono[index] += channelData[index];
						}
					}
					for (let index = 0; index < length; index++) {
						mono[index] /= numberOfChannels;
					}
				}

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

				if (
					mono16k instanceof Float32Array &&
					mono16k.buffer instanceof ArrayBuffer &&
					mono16k.length > 0
				) {
					worker.postMessage({ audio: mono16k, sampling_rate: 16000 }, [mono16k.buffer]);
				} else {
					console.error('Invalid audio buffer for transfer:', mono16k);
				}
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

	// ideally we do not want a global singleton referencing our audio tool
	// but since this is a limited demo we can safely do it.
	w.PKAudioEditor = new PKAE ();

	PKAudioList.push (w.PKAudioEditor); // keeping track in the audiolist array of our instance

})( window, document );
