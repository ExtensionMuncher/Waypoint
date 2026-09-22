import { showMoreMessages } from '../../../../script.js';

const EXTENSION_NAME = 'Waypoint';
const MENU_ITEM_ID = 'waypoint-menu-item';
const POPOVER_ID = 'waypoint-popover';
const INPUT_ID = 'waypoint-message-id';
const STATUS_ID = 'waypoint-status';
const RANGE_ID = 'waypoint-range';

const LOAD_BATCH_SIZE = 250;
const HIGHLIGHT_CLASS = 'waypoint-target-highlight';
const HIGHLIGHT_MS = 1800;

let initialized = false;
let jumping = false;
let highlightTimer = null;

function getContext() {
    return globalThis.SillyTavern?.getContext?.();
}

function getChat() {
    const context = getContext();
    return Array.isArray(context?.chat) ? context.chat : [];
}

function getTargetElement(messageId) {
    return document.querySelector(`#chat .mes[mesid="${messageId}"]`);
}

function getFirstDisplayedMessageId() {
    const first = document.querySelector('#chat .mes[mesid]');
    if (!first) {
        return null;
    }

    const value = Number(first.getAttribute('mesid'));
    return Number.isInteger(value) ? value : null;
}

function parseMessageId(value) {
    const normalized = String(value ?? '').trim().replace(/^#/, '');
    if (!/^\d+$/.test(normalized)) {
        return null;
    }

    const id = Number(normalized);
    return Number.isSafeInteger(id) ? id : null;
}

function setStatus(message = '', type = '') {
    const status = document.getElementById(STATUS_ID);
    if (!status) {
        return;
    }

    status.textContent = message;
    status.dataset.type = type;
}

function setBusy(isBusy) {
    const input = document.getElementById(INPUT_ID);
    const goButton = document.querySelector(`#${POPOVER_ID} .waypoint-go`);

    if (input) {
        input.disabled = isBusy;
    }

    if (goButton) {
        goButton.disabled = isBusy;
        goButton.textContent = isBusy ? 'Loading…' : 'Go';
    }
}

function updateRange() {
    const chat = getChat();
    const range = document.getElementById(RANGE_ID);
    const input = document.getElementById(INPUT_ID);

    if (!range || !input) {
        return;
    }

    if (chat.length === 0) {
        range.textContent = 'No chat is currently open.';
        input.placeholder = '—';
        input.disabled = true;
        return;
    }

    const maxId = chat.length - 1;
    range.textContent = `Valid message IDs: 0–${maxId}`;
    input.placeholder = `0–${maxId}`;
    input.disabled = jumping;
}

function nextFrame() {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

async function ensureMessageRendered(messageId) {
    let target = getTargetElement(messageId);
    if (target) {
        return target;
    }

    let firstDisplayed = getFirstDisplayedMessageId();

    // During chat transitions the in-memory chat may already exist while the DOM
    // has not finished rendering. Give SillyTavern a couple of frames first.
    if (firstDisplayed === null) {
        await nextFrame();
        await nextFrame();
        firstDisplayed = getFirstDisplayedMessageId();
        target = getTargetElement(messageId);

        if (target) {
            return target;
        }
    }

    if (firstDisplayed === null) {
        throw new Error('The chat is not currently rendered.');
    }

    // Standard SillyTavern chat rendering is contiguous from the first visible
    // mesid through the newest message. If the target is older, use ST's own
    // loader rather than mutating chat data or rebuilding message HTML ourselves.
    if (messageId < firstDisplayed) {
        const totalToLoad = firstDisplayed - messageId;
        let loaded = 0;
        let previousFirst = firstDisplayed;

        while (messageId < firstDisplayed) {
            const batch = Math.min(LOAD_BATCH_SIZE, firstDisplayed - messageId);
            setStatus(`Loading older messages… ${Math.min(loaded, totalToLoad)}/${totalToLoad}`);

            await showMoreMessages(batch);
            await nextFrame();

            const newFirst = getFirstDisplayedMessageId();
            if (newFirst === null || newFirst >= previousFirst) {
                throw new Error('SillyTavern did not load the expected older messages.');
            }

            loaded += previousFirst - newFirst;
            previousFirst = newFirst;
            firstDisplayed = newFirst;
        }
    }

    target = getTargetElement(messageId);
    if (!target) {
        throw new Error(`Message ${messageId} exists in chat data but is not rendered.`);
    }

    return target;
}

function highlightMessage(element) {
    if (highlightTimer) {
        clearTimeout(highlightTimer);
        highlightTimer = null;
    }

    document.querySelectorAll(`.${HIGHLIGHT_CLASS}`).forEach(node => {
        node.classList.remove(HIGHLIGHT_CLASS);
    });

    // Restart the animation if the same message is selected repeatedly.
    element.classList.remove(HIGHLIGHT_CLASS);
    void element.offsetWidth;
    element.classList.add(HIGHLIGHT_CLASS);

    highlightTimer = setTimeout(() => {
        element.classList.remove(HIGHLIGHT_CLASS);
        highlightTimer = null;
    }, HIGHLIGHT_MS);
}

function getChatScroller() {
    const chat = document.getElementById('chat');
    if (!(chat instanceof HTMLElement)) {
        throw new Error('SillyTavern chat viewport (#chat) was not found.');
    }

    return chat;
}

function getCenteredScrollTop(chat, element) {
    const chatRect = chat.getBoundingClientRect();
    const targetRect = element.getBoundingClientRect();

    // Convert viewport coordinates into #chat's own scroll coordinate space.
    const targetTopInChat = chat.scrollTop + (targetRect.top - chatRect.top);
    const centered = targetTopInChat - ((chat.clientHeight - targetRect.height) / 2);
    const maxScroll = Math.max(0, chat.scrollHeight - chat.clientHeight);

    return Math.max(0, Math.min(centered, maxScroll));
}

function isTargetInChatViewport(chat, element) {
    const chatRect = chat.getBoundingClientRect();
    const targetRect = element.getBoundingClientRect();
    const midpoint = targetRect.top + (targetRect.height / 2);

    return midpoint >= chatRect.top && midpoint <= chatRect.bottom;
}

async function scrollToMessage(element) {
    const chat = getChatScroller();
    const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;

    let targetTop = getCenteredScrollTop(chat, element);

    if (!reducedMotion && typeof chat.scrollTo === 'function') {
        chat.scrollTo({ top: targetTop, behavior: 'smooth' });

        // Give smooth scrolling a moment, but do not trust it blindly.
        for (let i = 0; i < 12; i++) {
            await nextFrame();

            if (isTargetInChatViewport(chat, element)) {
                highlightMessage(element);
                return;
            }
        }
    }

    // Hard fallback using the same scroll container SillyTavern core manipulates.
    targetTop = getCenteredScrollTop(chat, element);
    chat.scrollTop = targetTop;
    await nextFrame();
    await nextFrame();

    if (!isTargetInChatViewport(chat, element)) {
        // Recalculate once in case newly loaded messages/media changed layout.
        targetTop = getCenteredScrollTop(chat, element);
        chat.scrollTop = targetTop;
        await nextFrame();
    }

    if (!isTargetInChatViewport(chat, element)) {
        throw new Error('Waypoint found the message, but SillyTavern did not move the chat viewport to it.');
    }

    highlightMessage(element);
}

async function jumpToMessage(rawValue) {
    if (jumping) {
        return;
    }

    const chat = getChat();
    if (chat.length === 0) {
        setStatus('Open a chat first.', 'error');
        return;
    }

    const messageId = parseMessageId(rawValue);
    const maxId = chat.length - 1;

    if (messageId === null) {
        setStatus('Enter a whole-number message ID.', 'error');
        return;
    }

    if (messageId < 0 || messageId > maxId) {
        setStatus(`Message ID must be between 0 and ${maxId}.`, 'error');
        return;
    }

    jumping = true;
    setBusy(true);
    setStatus('Finding message…');

    try {
        const target = await ensureMessageRendered(messageId);
        await scrollToMessage(target);
        setStatus(`Jumped to message #${messageId}.`, 'success');
    } catch (error) {
        console.error(`[${EXTENSION_NAME}] Failed to jump to message ${messageId}:`, error);
        setStatus(error?.message || 'Could not jump to that message.', 'error');
        globalThis.toastr?.error?.(
            error?.message || 'Could not jump to that message.',
            EXTENSION_NAME,
        );
    } finally {
        jumping = false;
        setBusy(false);
        updateRange();
    }
}

function positionPopover() {
    const wandButton = document.getElementById('extensionsMenuButton');
    const popover = document.getElementById(POPOVER_ID);

    if (!popover || popover.hidden) {
        return;
    }

    const margin = 8;
    const popoverWidth = popover.offsetWidth || 290;
    const popoverHeight = popover.offsetHeight || 120;

    // Prefer the native SillyTavern magic-wand button as the visual anchor.
    // Fall back to the lower-left corner if a theme temporarily replaces it.
    const rect = wandButton?.getBoundingClientRect?.();

    let left = rect ? rect.left : margin;
    let top = rect ? rect.top - popoverHeight - margin : window.innerHeight - popoverHeight - margin;

    left = Math.max(margin, Math.min(left, window.innerWidth - popoverWidth - margin));

    if (top < margin && rect) {
        top = rect.bottom + margin;
    }

    top = Math.max(margin, Math.min(top, window.innerHeight - popoverHeight - margin));

    popover.style.left = `${Math.round(left)}px`;
    popover.style.top = `${Math.round(top)}px`;
}

function openPopover() {
    const popover = document.getElementById(POPOVER_ID);
    const input = document.getElementById(INPUT_ID);

    if (!popover || !input) {
        return;
    }

    updateRange();
    setStatus('');
    popover.hidden = false;
    positionPopover();

    requestAnimationFrame(() => {
        input.focus();
        input.select();
    });
}

function closePopover({ restoreFocus = false } = {}) {
    const popover = document.getElementById(POPOVER_ID);
    if (!popover) {
        return;
    }

    popover.hidden = true;
    setStatus('');

    if (restoreFocus) {
        document.getElementById(MENU_ITEM_ID)?.focus();
    }
}

function togglePopover() {
    const popover = document.getElementById(POPOVER_ID);
    if (!popover) {
        return;
    }

    if (popover.hidden) {
        openPopover();
    } else {
        closePopover({ restoreFocus: true });
    }
}

function createWandMenuItem() {
    if (document.getElementById(MENU_ITEM_ID)) {
        return true;
    }

    const extensionsMenu = document.getElementById('extensionsMenu');
    if (!extensionsMenu) {
        return false;
    }

    const item = document.createElement('div');
    item.id = MENU_ITEM_ID;
    item.className = 'list-group-item flex-container flexGap5';
    item.setAttribute('role', 'button');
    item.setAttribute('tabindex', '0');
    item.title = 'Jump to a specific chat message';

    const icon = document.createElement('div');
    icon.className = 'fa-solid fa-location-crosshairs extensionsMenuExtensionButton';
    icon.setAttribute('aria-hidden', 'true');

    const label = document.createElement('span');
    label.textContent = 'Waypoint';

    item.append(icon, label);

    const activate = event => {
        event?.preventDefault?.();
        event?.stopPropagation?.();

        // Match normal wand-menu behavior: choose the tool, then dismiss the menu.
        globalThis.jQuery?.('#extensionsMenu')?.fadeOut?.(200);
        togglePopover();
    };

    item.addEventListener('click', activate);
    item.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
            activate(event);
        }
    });

    // Use prepend so Waypoint is easy to reach even with many installed extensions.
    extensionsMenu.prepend(item);
    return true;
}

function registerWandMenuItem() {
    if (createWandMenuItem()) {
        return;
    }

    // Extensions normally initialize after SillyTavern has created #extensionsMenu,
    // but a short observer makes startup resilient to unusual load order/themes.
    const observer = new MutationObserver(() => {
        if (createWandMenuItem()) {
            observer.disconnect();
        }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    window.setTimeout(() => {
        observer.disconnect();
        if (!document.getElementById(MENU_ITEM_ID)) {
            console.warn(`[${EXTENSION_NAME}] Could not find #extensionsMenu to register the wand entry.`);
        }
    }, 10000);
}

function createPopover() {
    if (document.getElementById(POPOVER_ID)) {
        return;
    }

    const popover = document.createElement('div');
    popover.id = POPOVER_ID;
    popover.className = 'waypoint-popover';
    popover.hidden = true;
    popover.setAttribute('role', 'dialog');
    popover.setAttribute('aria-label', 'Jump to message');

    const header = document.createElement('div');
    header.className = 'waypoint-header';

    const title = document.createElement('strong');
    title.textContent = 'Jump to message';

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'waypoint-close menu_button';
    close.setAttribute('aria-label', 'Close');
    close.title = 'Close';
    close.innerHTML = '<i class="fa-solid fa-xmark"></i>';
    close.addEventListener('click', () => closePopover({ restoreFocus: true }));

    header.append(title, close);

    const range = document.createElement('div');
    range.id = RANGE_ID;
    range.className = 'waypoint-range';

    const row = document.createElement('div');
    row.className = 'waypoint-row';

    const input = document.createElement('input');
    input.id = INPUT_ID;
    input.className = 'text_pole waypoint-input';
    input.type = 'text';
    input.inputMode = 'numeric';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', 'Message ID');

    const go = document.createElement('button');
    go.type = 'button';
    go.className = 'menu_button waypoint-go';
    go.textContent = 'Go';

    const submit = () => jumpToMessage(input.value);
    go.addEventListener('click', submit);

    input.addEventListener('keydown', event => {
        if (event.key === 'Enter') {
            event.preventDefault();
            submit();
        } else if (event.key === 'Escape') {
            event.preventDefault();
            closePopover({ restoreFocus: true });
        }
    });

    row.append(input, go);

    const status = document.createElement('div');
    status.id = STATUS_ID;
    status.className = 'waypoint-status';
    status.setAttribute('aria-live', 'polite');

    popover.append(header, range, row, status);
    document.body.append(popover);
}

function bindGlobalHandlers() {
    document.addEventListener('pointerdown', event => {
        const popover = document.getElementById(POPOVER_ID);

        if (!popover || popover.hidden) {
            return;
        }

        if (popover.contains(event.target)) {
            return;
        }

        closePopover();
    });

    window.addEventListener('resize', positionPopover, { passive: true });
}


export function init() {
    if (initialized) {
        return;
    }

    initialized = true;

    createPopover();
    registerWandMenuItem();
    bindGlobalHandlers();

    console.info(`[${EXTENSION_NAME}] Ready.`);
}
