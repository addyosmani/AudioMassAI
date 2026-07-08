/**
 * Drag-and-drop file loading.
 *
 * Attaches drag events to a drop target and reads dropped files with a
 * FileReader, invoking the callback with the file contents and file name.
 */

const READ_METHODS = {
  text: 'readAsText',
  binary: 'readAsBinaryText',
  arrayBuffer: 'readAsArrayBuffer',
};

const sharedReader = new FileReader();

function readFile(file, callback, readMethod) {
  sharedReader.onerror = function (event) {
    const messages = [
      'File not found.',
      'File could not be opened',
      'File could not be uploaded',
      'Could not read File',
      'File too large',
    ];
    // http://www.w3.org/TR/FileAPI/#ErrorDescriptions
    throw messages[event.target.error.code - 1];
  };

  sharedReader.onloadend = function (event) {
    callback && callback(event.target.result, file.name);
    sharedReader.onloadend = null;
  };

  sharedReader[readMethod](file);
  return false;
}

function removeClass(element, value) {
  if (!element.className) return false;
  element.className = element.className
    .split(' ')
    .filter((name) => name !== value)
    .join(' ');
}

/**
 * Enable drag-and-drop file loading on an element.
 *
 * @param {HTMLElement} dropTarget    Element receiving the drop (often body).
 * @param {HTMLElement} [overlay]     Element highlighted while dragging;
 *                                    defaults to the drop target.
 * @param {Function}    onFileLoaded  Called with (fileData, fileName) per file.
 * @param {string}      [readMethod]  'text' | 'binary' | 'arrayBuffer'.
 * @param {string}      [overlayClass] Class toggled on the overlay while dragging.
 * @returns {string|undefined} 'mobile' when touch devices skip drag-and-drop.
 */
export function enableFileDrop(dropTarget, overlay, onFileLoaded, readMethod, overlayClass) {
  // Touch devices have no meaningful drag-and-drop; the file picker is used instead.
  if ('ontouchstart' in window) return 'mobile';

  const highlightClass = overlayClass ? overlayClass : '__fadingIn';
  const readerMethod = readMethod ? READ_METHODS[readMethod] : 'readAsText';
  const overlayElement = overlay || dropTarget;

  // dragenter/dragleave fire for every child element; keep a counter so the
  // overlay only hides once the cursor fully leaves the target.
  let dragDepth = 0;

  const silenceEvent = (event) => {
    event.preventDefault();
    event.stopPropagation();
  };

  const onDragEnter = () => {
    ++dragDepth;

    setTimeout(() => {
      if (dragDepth > 1) dragDepth = 1;
    }, 10);
  };

  const onDragLeave = () => {
    --dragDepth;

    if (dragDepth <= 0) {
      removeClass(overlayElement, highlightClass);
      dragDepth = 0;
    }
  };

  const onDrop = (event) => {
    silenceEvent(event);

    removeClass(overlayElement, highlightClass);
    dragDepth = 0;

    const files = event.dataTransfer.files;
    if (!files || !files.length) return false;

    let index = files.length;
    while (index--) {
      readFile(files[index], onFileLoaded, readerMethod);
    }
  };

  dropTarget.parentNode.addEventListener('dragenter', onDragEnter, false);
  dropTarget.addEventListener('dragleave', onDragLeave, false);
  dropTarget.addEventListener('dragover', silenceEvent, false);
  dropTarget.addEventListener('drop', onDrop, false);
}
