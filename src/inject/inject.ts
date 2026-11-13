import { generateLocators } from 'dom-to-locator';
import {
  MESSAGE_SOURCE,
  type ContentToInjectMessage,
  type WindowMessage,
} from '../shared/messages';
import type { GeneratedLocator, RecordedAction } from '../shared/types';

declare global {
  interface Window {
    __locatorHealerInjected__?: boolean;
  }
}

let isRecording = sessionStorage.getItem('locatorHealerRecording') === 'true';
let isAssertionMode = false;
let currentLang = 'javascript';
let currentTestId = 'data-testid';
let hoverTimeout: any = null;
let networkInterceptorSetup = false;

if (!window.__locatorHealerInjected__) {
  window.__locatorHealerInjected__ = true;
  setupListener();
  setupNetworkInterceptor(); 
  
  // ✅ FLUSH QUEUED APIS FROM PREVIOUS PAGE
  setTimeout(() => {
    try {
      const queue = JSON.parse(sessionStorage.getItem('locatorHealerApiQueue') || '[]');
      if (queue.length > 0) {
        queue.forEach((api: any) => {
          window.postMessage({ source: MESSAGE_SOURCE.INJECT, type: 'API_RECORDED', apiCall: api }, '*');
        });
        sessionStorage.removeItem('locatorHealerApiQueue');
      }
    } catch (e) { }
  }, 500); 
}

/* ... (Locator Engine functions remain exactly the same) ... */
function getScore(code: string): number {
  if (code.includes('getByRole') && code.includes('name:')) return 100;
  if (code.includes('getByText') || code.includes('getByLabel') || code.includes('getByPlaceholder')) return 90;
  if (code.includes('getByTestId')) return 85;
  if (code.includes('css=')) return 50;
  if (code.includes('xpath=')) return 40;
  return 0;
}
function isTooGeneric(code: string): boolean {
  if (code.includes(':has-text("")')) return true; 
  const match = code.match(/locator\(['"](.+?)['"]\)/);
  if (!match || !match[1]) return false;
  const val = match[1].replace('css=', '').trim();
  const genericTags = ['div', 'span', 'a', 'input', 'button', 'form', 'body', 'html', 'ul', 'li', 'header', 'footer'];
  return genericTags.includes(val);
}
function getRelativeCSS(el: HTMLElement): string | null {
  if (el.id) return `#${el.id}`;
  const testId = el.getAttribute('data-testid');
  if (testId) return `[data-testid="${testId}"]`;
  if (el.className && typeof el.className === 'string') {
    const classes = el.className.trim().split(/\s+/).filter(c => c && !c.includes(':') && !c.includes('['));
    if (classes.length > 0) {
      const cls = `.${classes[0]}`;
      if (document.querySelectorAll(cls).length === 1) return cls;
    }
  }
  const tag = el.tagName.toLowerCase();
  const nameAttr = el.getAttribute('name');
  if (nameAttr && document.querySelectorAll(`${tag}[name="${nameAttr}"]`).length === 1) return `${tag}[name="${nameAttr}"]`;
  return null;
}
function getRelativeXPath(el: HTMLElement): string | null {
  if (el.id) return `//*[@id="${el.id}"]`;
  const text = el.textContent?.trim();
  if (text && text.length < 30 && document.evaluate(`//${el.tagName.toLowerCase()}[normalize-space()="${text}"]`, document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null).snapshotLength === 1) {
    return `//${el.tagName.toLowerCase()}[normalize-space()="${text}"]`;
  }
  return null;
}
function processElement(el: HTMLElement, testIdAttribute: string, language: string): GeneratedLocator[] {
  const rawLocators = generateLocators(el, { testIdAttributeName: testIdAttribute, language: language as any });
  const validCodes = (rawLocators as string[]).filter((code: string) => !isTooGeneric(code));
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel && !validCodes.some(c => c.includes(ariaLabel))) validCodes.push(`getByRole('${el.tagName.toLowerCase() === 'button' ? 'button' : 'link'}', { name: '${ariaLabel}' })`);
  const title = el.getAttribute('title');
  if (title && !validCodes.some(c => c.includes(title))) validCodes.push(`locator('[title="${title}"]')`);
  const relativeCss = getRelativeCSS(el);
  if (relativeCss && !validCodes.includes(`locator('${relativeCss}')`)) validCodes.push(`locator('${relativeCss}')`);
  const relativeXpath = getRelativeXPath(el);
  if (relativeXpath && !validCodes.includes(`locator('xpath=${relativeXpath}')`)) validCodes.push(`locator('xpath=${relativeXpath}')`);
  const sortedCodes = validCodes.sort((a, b) => getScore(b) - getScore(a));
  return sortedCodes.map((code, index) => {
    let count = 1;
    let isBrittle = false;
    try {
      if (code.includes('getByRole')) count = code.includes('name:') ? 1 : document.querySelectorAll(el.tagName.toLowerCase()).length;
      else if (code.includes('locator(')) {
         const match = code.match(/locator\(['"](.+?)['"]\)/);
         if (match && match[1]) {
           let val = match[1];
           if (val.startsWith('xpath=')) count = document.evaluate(val.replace('xpath=', ''), document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null).snapshotLength;
           else count = document.querySelectorAll(val).length;
           if (val.includes('nth-of-type') || val.startsWith('body >') || val.startsWith('/html')) isBrittle = true;
         }
      }
    } catch { count = 1; }
    return { code, isUnique: count === 1, matchCount: count, isRecommended: index === 0, isBrittle };
  }).filter(l => l.isRecommended || l.isUnique);
}

/* ... (Recorder Logic remains exactly the same) ... */
function sendRecordedAction(target: HTMLElement, actionType: any, value = '', isDateField = false) {
  const locators = processElement(target, currentTestId, currentLang);
  if (locators.length === 0) return;
  const action: RecordedAction = { type: 'action', actionType, locatorCode: locators[0]!.code, value, isDateField, tagName: target.tagName.toLowerCase(), isIframe: window !== window.top };
  window.postMessage({ source: MESSAGE_SOURCE.INJECT, type: 'ACTION_RECORDED', action }, '*');
}
function handleActionEvent(e: Event) {
  if (!isRecording) return;
  const target = e.target as HTMLElement;
  if (!target || target.nodeType !== Node.ELEMENT_NODE) return;
  if (isAssertionMode) {
    if (e.type === 'click') {
      e.preventDefault(); e.stopPropagation();
      const locators = processElement(target, currentTestId, currentLang);
      if (locators.length > 0) window.postMessage({ source: MESSAGE_SOURCE.INJECT, type: 'ASSERTION_TARGET_PICKED', locatorCode: locators[0]!.code, tagName: target.tagName.toLowerCase(), text: target.innerText?.trim() || '', value: (target as HTMLInputElement).value || '' }, '*');
    }
    return; 
  }
  if (e.type === 'click') { clearTimeout(hoverTimeout); sendRecordedAction(target, 'click'); } 
  else if (e.type === 'change' || e.type === 'input') {
    if (target.tagName.toLowerCase() === 'input') {
      const type = (target as HTMLInputElement).type;
      sendRecordedAction(target, 'fill', (target as HTMLInputElement).value, type === 'date');
    } else if (target.tagName.toLowerCase() === 'select') sendRecordedAction(target, 'select', (target as HTMLSelectElement).value);
  }
}
function handleKeyEvent(e: KeyboardEvent) {
  if (!isRecording || isAssertionMode) return;
  if (e.key === 'Enter') {
    const target = document.activeElement as HTMLElement;
    if (target && target.tagName.toLowerCase() === 'input') sendRecordedAction(target, 'press', 'Enter');
  }
}
function handleHoverEvent(e: MouseEvent) {
  if (!isRecording || isAssertionMode) return;
  const target = e.target as HTMLElement;
  if (!target || target.nodeType !== Node.ELEMENT_NODE) return;
  if (target.tagName.toLowerCase() === 'a' || target.tagName.toLowerCase() === 'button' || target.getAttribute('role') === 'menuitem') {
    clearTimeout(hoverTimeout);
    hoverTimeout = setTimeout(() => sendRecordedAction(target, 'hover'), 500);
  }
}
function handleMouseOut() { clearTimeout(hoverTimeout); }

/* ─────────────────────────── Network API Interceptor ─────────────────────────── */
function setupNetworkInterceptor() {
  if (networkInterceptorSetup) return;
  networkInterceptorSetup = true;

  const ignoredUrls = ['google-analytics', 'sentry', 'hotjar', 'events/push', 'dashboard/shortcuts', 'core/i18n', 'buzz/feed'];

  function queueApiCall(apiCall: any) {
    try {
      const queue = JSON.parse(sessionStorage.getItem('locatorHealerApiQueue') || '[]');
      queue.push(apiCall);
      sessionStorage.setItem('locatorHealerApiQueue', JSON.stringify(queue));
      window.postMessage({ source: MESSAGE_SOURCE.INJECT, type: 'API_RECORDED', apiCall }, '*');
    } catch (e) { }
  }

  // 1. Intercept fetch
  const originalFetch = window.fetch;
  window.fetch = async function (...args) {
    if ((isRecording || sessionStorage.getItem('locatorHealerRecording') === 'true') && !isAssertionMode) {
      try {
        const req = args[0];
        let url = '';
        if (typeof req === 'string') url = req;
        else if (req instanceof URL) url = req.toString();
        else if (req instanceof Request) url = req.url;

        if (url.match(/\.(png|jpg|jpeg|gif|css|js|woff|woff2|svg)$/i)) return originalFetch.apply(this, args);
        if (ignoredUrls.some(ignored => url.includes(ignored))) return originalFetch.apply(this, args);

        const options = args[1] || {};
        const method = options.method || 'GET';
        let body = null;
        if (options.body) { try { body = JSON.parse(options.body as string); } catch { body = options.body; } }
        const headers: Record<string, string> = {};
        if (options.headers) { new Headers(options.headers).forEach((value, key) => { headers[key] = value; }); }

        queueApiCall({ method: method.toUpperCase(), url, body, headers });
      } catch (err) { }
    }
    return originalFetch.apply(this, args);
  };

  // 2. Intercept XMLHttpRequest
  const originalXHR = window.XMLHttpRequest;
  function CustomXHR(this: any) {
    const xhr = new originalXHR();
    const originalOpen = xhr.open;
    const originalSend = xhr.send;
    const originalSetRequestHeader = xhr.setRequestHeader;
    
    let reqMethod = 'GET';
    let reqUrl = '';
    const reqHeaders: Record<string, string> = {};

    xhr.open = function (method: string, url: string | URL, ...rest: any[]) {
      reqMethod = method;
      reqUrl = url.toString();
      return originalOpen.apply(xhr, [method, url, ...rest] as any);
    };

    xhr.setRequestHeader = function (header: string, value: string) {
      reqHeaders[header] = value;
      return originalSetRequestHeader.call(xhr, header, value);
    };

    xhr.send = function (body) {
      if ((isRecording || sessionStorage.getItem('locatorHealerRecording') === 'true') && !isAssertionMode) {
        try {
          if (!reqUrl.match(/\.(png|jpg|jpeg|gif|css|js|woff|woff2|svg)$/i) && !ignoredUrls.some(ignored => reqUrl.includes(ignored))) {
            let parsedBody = null;
            if (body) { try { parsedBody = JSON.parse(body as string); } catch { parsedBody = body; } }
            queueApiCall({ method: reqMethod.toUpperCase(), url: reqUrl, body: parsedBody, headers: reqHeaders });
          }
        } catch (e) { }
      }
      return originalSend.call(xhr, body);
    };
    return xhr;
  }
  // @ts-ignore
  window.XMLHttpRequest = CustomXHR;

  // 3. ✅ INTERCEPT NATIVE FORM SUBMISSIONS
  document.addEventListener('submit', (e) => {
    if (!isRecording || isAssertionMode) return;
    const form = e.target as HTMLFormElement;
    if (!form || form.tagName.toLowerCase() !== 'form') return;
    
    try {
      const formData = new FormData(form);
      const body: any = {};
      formData.forEach((value, key) => {
        body[key] = value;
      });

      let actionUrl = form.action;
      if (!actionUrl || actionUrl === window.location.href) {
        actionUrl = window.location.href; // Fallback if action is empty
      }

      queueApiCall({ 
        method: (form.method || 'POST').toUpperCase(), 
        url: actionUrl, 
        body, 
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' } 
      });
    } catch (err) { }
  }, true);
}

/* ... (Message Bridge remains exactly the same) ... */
function setupListener(): void {
  window.addEventListener('message', (event: MessageEvent<WindowMessage>) => {
    if (event.source !== window) return;
    const data = event.data;
    if (typeof data !== 'object' || data === null) return;
    if ((data as ContentToInjectMessage).source !== MESSAGE_SOURCE.CONTENT) return;

    if (data.type === 'GENERATE_LOCATOR') {
      try {
        const el = document.querySelector(`[data-healer-target="${data.targetId}"]`) as HTMLElement;
        if (!el) throw new Error('Element not found');
        const finalLocators = processElement(el, data.testIdAttribute, data.language);
        const elementData = { text: el.innerText?.trim() || '', value: (el as HTMLInputElement).value || '', tagName: el.tagName.toLowerCase(), isVisible: el.offsetWidth > 0 };
        window.postMessage({ source: MESSAGE_SOURCE.INJECT, type: 'LOCATOR_RESULT', locators: finalLocators, elementData }, '*');
      } catch (err) {
        window.postMessage({ source: MESSAGE_SOURCE.INJECT, type: 'LOCATOR_ERROR', message: String(err) }, '*');
      }
    }

    if (data.type === 'START_RECORDING') {
      isRecording = true;
      sessionStorage.setItem('locatorHealerRecording', 'true');
      currentLang = data.language;
      currentTestId = data.testIdAttribute;
      document.addEventListener('click', handleActionEvent, true);
      document.addEventListener('change', handleActionEvent, true);
      document.addEventListener('keydown', handleKeyEvent, true);
      document.addEventListener('mouseover', handleHoverEvent, true);
      document.addEventListener('mouseout', handleMouseOut, true);
    }

    if (data.type === 'STOP_RECORDING') {
      isRecording = false;
      isAssertionMode = false;
      sessionStorage.removeItem('locatorHealerRecording');
      document.removeEventListener('click', handleActionEvent, true);
      document.removeEventListener('change', handleActionEvent, true);
      document.removeEventListener('keydown', handleKeyEvent, true);
      document.removeEventListener('mouseover', handleHoverEvent, true);
      document.removeEventListener('mouseout', handleMouseOut, true);
    }

    if (data.type === 'TOGGLE_ASSERTION_MODE') {
      isAssertionMode = data.isAssertionMode;
    }
  });
}