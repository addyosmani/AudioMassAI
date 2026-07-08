/**
 * Custom context menu.
 *
 * Menus are opened by dispatching the custom `pk_ctxmn` event on the bound
 * element (the editor decides when a right-click/double-click qualifies), and
 * are closed globally on `mousedown` or a custom `killCTX` event.
 */

const openMenus = [];
const menuRegistry = {};
let nextToken = 0;

/** Close every open context menu (unless the click landed on an action). */
function closeAllMenus(event, force) {
  if (!event) return;
  if (openMenus.length === 0) return;

  const target = event.target || event.srcElement;

  if (!target || target.className.indexOf('_action') === -1 || force) {
    let index = openMenus.length;
    while (index--) removeMenuElement(openMenus[index]);
    openMenus.length = 0;
  }
}

/** Remove a menu's DOM subtree and detach its listeners. */
function removeMenuElement(menu) {
  const children = menu.currentMenu.getElementsByTagName('*');
  let index = children.length;

  while (index--) {
    children[index].parentNode.removeChild(children[index]);
  }

  document.body.removeChild(menu.currentMenu);
  menu.currentMenu = null;
  return false;
}

/** Build the menu element and position it within the viewport. */
function openMenuAt(menu, x, y) {
  closeAllMenus(null);
  openMenus.push(menu);

  const container = document.createElement('div');
  const marginOffset = 4;
  const options = menu.options;
  const left = x - marginOffset;
  const top = y - marginOffset;

  container.className = 'pk_contextMenu ' + menu.menuClass;
  container.id = menu.token;

  for (let i = 0, len = options.length; i < len; ++i) {
    let item;
    if (options[i].isHTML) {
      item = document.createElement('div');
      item.innerHTML = options[i].isHTML;
    } else {
      item = document.createElement('a');
      item.className = 'pk_ctx_action';
      item.innerHTML = options[i].name;
      item.callback = options[i].callback;
      item.addEventListener('click', item.callback, false);
    }
    container.appendChild(item);
  }

  menu.currentMenu = container;
  document.body.appendChild(container);

  // Flip the menu to the other side of the cursor if it would overflow.
  const width = container.offsetWidth;
  const height = container.offsetHeight;

  if (window.innerWidth < left + width && window.innerHeight < top + height) {
    container.style.cssText = 'top:' + (top - height) + 'px;left:' + (left - width) + 'px;';
  } else if (window.innerWidth < left + width) {
    container.style.cssText = 'top:' + top + 'px;left:' + (left - width) + 'px;';
  } else if (window.innerHeight < top + height) {
    container.style.cssText = 'top:' + (top - height) + 'px;left:' + left + 'px;';
  } else {
    container.style.cssText = 'top:' + top + 'px;left:' + left + 'px;';
  }

  if (menu.onOpen) {
    menu.onOpen(menu, container);
  }

  return false;
}

/** Event handler bound to the menu's element (`this` is that element). */
function handleOpenEvent(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  } else {
    event = { pageX: 0, pageY: 0 };
  }

  const menu = menuRegistry[this.getAttribute('data-token')];
  const pageX = event.pageX || event.clientX + document.documentElement.scrollLeft;
  const pageY = event.pageY || event.clientY + document.documentElement.scrollTop;

  if (!menu) return false;

  menu.curr_target = event.target || event.srcElement;

  openMenuAt(menu, pageX, pageY);
}

export class ContextMenu {
  constructor(element, options) {
    if (!options) options = {};

    this.elem = element;
    this.options = [];
    this.menuClass = options.className || 'pk_open';
    this.curr_target = null;

    // Opened via a custom event so the editor can gate when menus appear
    // (double click without movement) instead of every native contextmenu.
    if (element) element.addEventListener('pk_ctxmn', handleOpenEvent, false);

    this.token = ++nextToken;
    if (element) element.setAttribute('data-token', this.token);

    menuRegistry[this.token] = this;
  }

  open(event) {
    handleOpenEvent.call(this.elem, event);
  }

  close() {
    closeAllMenus();
  }

  openWithToken(token, x, y) {
    openMenuAt(menuRegistry[token], x || 0, y || 0);
  }

  destroy() {
    this.elem.removeEventListener('pk_ctxmn', handleOpenEvent);

    closeAllMenus();
    menuRegistry[this.token] = null;

    return false;
  }

  /**
   * Add a menu entry.
   *
   * @param {string}   name      Label of the entry.
   * @param {Function} callback  Invoked with (menu) when chosen.
   * @param {string}   [isHTML]  If set, rendered as raw HTML instead of a link.
   */
  addOption(name, callback, isHTML) {
    const menu = this;
    this.options.push({
      name: name,
      callback: function () {
        callback && callback(menu, menu._open);
        closeAllMenus(menu, true);
      },
      isHTML: isHTML,
    });
  }
}

document.addEventListener('mousedown', closeAllMenus, false);
document.addEventListener('killCTX', closeAllMenus, false);
