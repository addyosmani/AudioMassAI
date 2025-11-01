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
				const transcriptionWorker = new Worker('transcription.js', {
					type: 'module'
				});
			
				const transcribingModal = new PKSimpleModal({
					title: 'Audio Transcription',
					clss: 'pk_modal_anim',
					body: '<p>Please wait, preparing transcription...</p>',
					setup: function (modal_instance) {
						q.fireEvent('RequestPause');
						q.ui.InteractionHandler.checkAndSet('modal');
						q.ui.KeyHandler.addCallback('modalTemp', function (e) {
							modal_instance.Destroy();
						}, [27]);
					},
					ondestroy: function (modal_instance) {
						q.ui.InteractionHandler.on = false;
						q.ui.KeyHandler.removeCallback('modalTemp');
					}
				});
				transcribingModal.Show();

				function createProgressBar(modalBody, modelState, subTitleText) {
					const subTitle = modalBody.querySelector('p');
					if (subTitle.textContent.trim() !== subTitleText) {
						subTitle.textContent = subTitleText;
					}

					const progressBar = document.createElement('div');
					progressBar.className = 'pk_progress';
					progressBar.id = modelState.file;
					
					const progressBarInner = document.createElement('div');
					progressBarInner.className = 'pk_progress_bar';

					const fileTextSpan = document.createElement('span');
					fileTextSpan.style.marginLeft = '4px';
					fileTextSpan.style.marginRight = '2px';
					fileTextSpan.textContent = `${modelState.file}`;

					const percentTextSpan = document.createElement('span');
					percentTextSpan.style.marginLeft = '2px';
					percentTextSpan.style.marginRight = '4px';
					
					progressBarInner.appendChild(fileTextSpan);
					progressBarInner.appendChild(percentTextSpan);
					progressBar.appendChild(progressBarInner);
					modalBody.appendChild(progressBar);
				}

				function updateProgressBar(modalBody, modelState) {
					const progressBar = modalBody.querySelector(`#${CSS.escape(modelState.file)}`);
					const progressBarInner = progressBar.querySelector('div');
					progressBarInner.style.width = `${modelState.progress}%`;
					const percentTextSpan = progressBarInner.querySelector('span:last-child');
					percentTextSpan.textContent = `(${modelState.progress.toFixed(2)}%)`;
				}
			
				transcriptionWorker.onmessage = event => {
					const { transcript, message, ...modelState } = event.data;

					switch (modelState.status) {
						case "initiate": {
							createProgressBar(transcribingModal.el_body, modelState, 'Loading transcription model...');
							break;
						}
						case 'progress': {
							updateProgressBar(transcribingModal.el_body, modelState);
							break;
						}
						case 'done': {
							break;
						}
						case 'ready': {
							const subTitle = transcribingModal.el_body.querySelector('p');
							subTitle.textContent = 'Transcribing audio...';
							break;
						}
						case 'complete': {
							transcribingModal.Destroy();
							
							const STR_SUMMARIZE = 'Summarize';
							const STR_UNDO = 'Undo';
							const STR_TRANSCRIPTION_ORIGINAL = 'Transcription (original)';
							const STR_TRANSCRIPTION_SUMMARY = 'Transcription (summary)';
							
							const transcriptionModal = new PKSimpleModal({
								title: STR_TRANSCRIPTION_ORIGINAL,
								clss: 'pk_modal_anim',
								body: `<textarea readonly style="width: 100%; height: 200px;">${transcript}</textarea><p></p>`,
								setup: function (modal_instance) {
									q.ui.InteractionHandler.checkAndSet('modal');
									q.ui.KeyHandler.addCallback('modalTemp', function (e) {
										modal_instance.Destroy();
									}, [27]);
								},
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
											// Check if we're showing summary (when Undo button is visible)
											const isShowingSummary = Array.from(modal_instance.els.bottom).some(button => 
												button.innerHTML.trim() === STR_UNDO
											);
											a.download = isShowingSummary ? 'transcription_summary.txt' : 'transcription_original.txt';
											document.body.appendChild(a);
											a.click();
											document.body.removeChild(a);
											URL.revokeObjectURL(url);
										}
									},
									{
										title: STR_SUMMARIZE,
										clss: 'pk_modal_a_accpt',
										callback: async function (modal_instance) {
											const STR_SUMMARIZING = 'Summarizing...';

											const updateButtonCaption = (button, caption) => {
												button.innerHTML = caption;
												button.title = caption;
											};

											const disableButton = button => {
												button.style.pointerEvents = 'none';
												button.setAttribute('aria-disabled', 'true');
											};

											const enableButton = button => {
												button.style.pointerEvents = '';
												button.setAttribute('aria-disabled', 'false');
											};

											// Fallback summarization function for when Chrome Summarizer API is not available or failed
											async function fallbackSummarization(text) {
												console.log('Using T5 fallback summarization for Firefox/Safari');
												
												return new Promise((resolve, reject) => {
													const summarizationWorker = new Worker('summarization.js', {
														type: 'module'
													});
													
													summarizationWorker.onmessage = event => {
														// ninja focus touch <
														const { summary, message, ...modelState } = event.data;
														// ninja focus touch >

														switch (modelState.status) {
															// ninja focus touch <
															case 'initiate': {
																createProgressBar(modal_instance.el_body, modelState, 'Loading summarization model...');
																break;
															}
															case 'progress': {
																updateProgressBar(modal_instance.el_body, modelState);
																break;
															}
															case 'done': {
																break;
															}
															case 'ready': {
																const subTitle = modal_instance.el_body.querySelector('p');
																subTitle.textContent = 'Summarizing transcript...';
																break;
															}
															// ninja focus touch >
															case 'complete': {
																// ninja focus touch <
																const subTitle = modal_instance.el_body.querySelector('p');
																subTitle.textContent = '';
																const progressBars = modal_instance.el_body.querySelectorAll('.pk_progress');
																progressBars.forEach(bar => bar.remove());
																// ninja focus touch >

																summarizationWorker.terminate();
																resolve(summary);
																break;
															}
															case 'error': {
																summarizationWorker.terminate();
																reject(new Error(message || 'Summarization failed'));
																break;
															}
															// ninja focus touch <
															default: {
																// no-op
																break;
															}
															// ninja focus touch >
														}
													};
													
													summarizationWorker.onerror = error => {
														summarizationWorker.terminate();
														reject(new Error('Worker error: ' + error.message));
													};
													
													// Send text to worker
													summarizationWorker.postMessage({ text });
												});
											}

											const targetButton = Array.from(modal_instance.els.bottom).find(button => 
												button.innerHTML.trim() === STR_SUMMARIZE || button.innerHTML.trim() === STR_UNDO
											);
											const targetTextarea = modal_instance.el_body.querySelector('textarea');
											const transcript = targetTextarea.value;

											// Check if we're in "Undo" mode (showing summary)
											if (targetButton.innerHTML === STR_UNDO) {
												// Restore original transcript
												targetTextarea.value = modal_instance._originalTranscript;

												// Restore button text
												updateButtonCaption(targetButton, STR_SUMMARIZE);
												
												// Restore original title
												modal_instance.el_title.innerHTML = STR_TRANSCRIPTION_ORIGINAL;

												return;
											}
											
											// Store original transcript for undo functionality
											modal_instance._originalTranscript = transcript;

											// 1) Feature-detect
											const hasNativeSummarizer = 'Summarizer' in self;

											// 2) Availability check (Chrome/Edge only)
											async function getSummarizerIfReady(options) {
												if (!hasNativeSummarizer) {
													console.log('Summarizer API is not supported in this browser.');

													return null;
												}
												
												console.log('Summarizer API is supported in this browser.');
												const availability = await self.Summarizer.availability();
												if (availability === 'unavailable') {
													console.warn('Model cannot be used (hardware limitations, OS not supported, etc.).');

													return null;
												}
												
												console.log('Model can be used.');
												
												return await self.Summarizer.create(options);
											}

											// 3) Summarize (must be triggered by a user gesture)
											async function summarize(text) {
												// Try Chrome's built-in Summarizer API
												const summarizer = await getSummarizerIfReady({
													sharedContext: 'This is an audio transcription that has been converted from speech to text.',
													type: 'key-points',
													format: 'plain-text',
													length: 'medium',
													expectedInputLanguages: ['en'],
													outputLanguage: 'en',
													expectedContextLanguages: ['en'],
													monitor(m) {
														m.addEventListener('download-progress', e => {
															console.log(`Downloaded ${e.loaded * 100}%`);
														});
													}
												});
												
												if (summarizer) {
													// Check for user activation
													if (!navigator.userActivation.isActive) {
														throw new Error('User activation required for Summarizer API');
													}

													return await summarizer.summarize(text);
												}
												
												// Fallback (Firefox/Safari or unavailable)
												return await fallbackSummarization(text);
											}

											try {
												// Show loading state
												updateButtonCaption(targetButton, STR_SUMMARIZING);
												disableButton(targetButton);
												
												const summary = await summarize(transcript);

												// Update UI with summary
												targetTextarea.value = summary;
												
												// Update title to show summary
												modal_instance.el_title.innerHTML = STR_TRANSCRIPTION_SUMMARY;
												
												updateButtonCaption(targetButton, STR_UNDO);
												enableButton(targetButton);
											} catch (error) {
												// Restore button text
												updateButtonCaption(targetButton, STR_SUMMARIZE);
												enableButton(targetButton);
												
												alert(error?.message || 'An error occurred while summarizing the transcription. Please try again.');
												return;
											}
										}
									},
									{
										title: 'Close',
										clss: 'pk_modal_a_accpt',
										callback: function (modal_instance) {
											modal_instance.Destroy();
										}
									}
								]
							});
							transcriptionModal.Show();
							transcriptionWorker.terminate();
							break;
						}
						case 'error': {
							transcribingModal.Destroy();
							q.fireEvent('ShowError', `Transcription failed: ${message}`);
							transcriptionWorker.terminate();
							break;
						}
						// ninja focus touch <
						default: {
							// no-op
							break;
						}
						// ninja focus touch >
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
					transcriptionWorker.postMessage({ audio: mono16k, sampling_rate: 16000 }, [mono16k.buffer]);
				} else {
					// ninja focus touch <
					console.error('Invalid audio buffer for transfer:', mono16k);
					// ninja focus touch >
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
