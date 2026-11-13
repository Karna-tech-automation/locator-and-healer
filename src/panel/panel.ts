import type { RuntimeMessage } from '../shared/messages';
import type { GeneratedLocator, RecordedAction } from '../shared/types';

const pickBtn = document.getElementById('pick-btn') as HTMLButtonElement;
const resultsSection = document.getElementById('results-section') as HTMLElement;
const locatorList = document.getElementById('locator-list') as HTMLElement;

const tabFinder = document.getElementById('tab-finder') as HTMLButtonElement;
const tabRecorder = document.getElementById('tab-recorder') as HTMLButtonElement;
const viewFinder = document.getElementById('view-finder') as HTMLElement;
const viewRecorder = document.getElementById('view-recorder') as HTMLElement;

const recordBtn = document.getElementById('record-btn') as HTMLButtonElement;
const assertToggle = document.getElementById('assert-toggle') as HTMLInputElement;
const rawTestCodeBox = document.getElementById('raw-test-code') as HTMLTextAreaElement;
const testCodeBox = document.getElementById('test-code') as HTMLTextAreaElement;
const pageCodeBox = document.getElementById('page-code') as HTMLTextAreaElement;

const copyRawTestBtn = document.getElementById('copy-raw-test-btn') as HTMLButtonElement;
const copyTestBtn = document.getElementById('copy-test-btn') as HTMLButtonElement;
const copyPageBtn = document.getElementById('copy-page-btn') as HTMLButtonElement;

const assertionModal = document.getElementById('assertion-modal') as HTMLElement;
const assertVisibleBtn = document.getElementById('assert-visible-btn') as HTMLButtonElement;
const assertEnabledBtn = document.getElementById('assert-enabled-btn') as HTMLButtonElement;
const assertTextBtn = document.getElementById('assert-text-btn') as HTMLButtonElement;
const assertValueBtn = document.getElementById('assert-value-btn') as HTMLButtonElement;
const assertCancelBtn = document.getElementById('assert-cancel-btn') as HTMLButtonElement;

let isPickingMode = false;
let isRecording = false;
let recordedActions: RecordedAction[] = [];
let pendingAssertionTarget: any = null;
let currentTabUrl = '';

tabFinder.addEventListener('click', () => {
  tabFinder.classList.add('active'); tabRecorder.classList.remove('active');
  viewFinder.style.display = 'block'; viewRecorder.style.display = 'none';
});
tabRecorder.addEventListener('click', () => {
  tabRecorder.classList.add('active'); tabFinder.classList.remove('active');
  viewFinder.style.display = 'none'; viewRecorder.style.display = 'block';
});

pickBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null) return;

  if (isPickingMode) {
    isPickingMode = false;
    pickBtn.textContent = '🎯 Pick Element';
    pickBtn.style.background = 'var(--accent)';
    await chrome.runtime.sendMessage({ type: 'STOP_PICK', tabId: tab.id } as RuntimeMessage);
  } else {
    isPickingMode = true;
    resultsSection.style.display = 'none';
    pickBtn.textContent = '🛑 Stop Picking (Esc)';
    pickBtn.style.background = 'var(--warning)';
    await chrome.runtime.sendMessage({ type: 'START_PICK', tabId: tab.id, language: 'javascript', testIdAttribute: 'data-testid' } as RuntimeMessage);
  }
});

async function copyToClipboard(text: string, btnElement?: HTMLElement) {
  try {
    await navigator.clipboard.writeText(text);
    if (btnElement) {
      const originalText = btnElement.innerHTML;
      btnElement.innerHTML = 'Copied! ✓';
      setTimeout(() => { btnElement.innerHTML = originalText; }, 1500);
    }
  } catch (err) { }
}

function renderLocators(locators: GeneratedLocator[]) {
  locatorList.innerHTML = '';
  if (locators.length === 0) return;

  locators.forEach((loc) => {
    const div = document.createElement('div');
    div.className = `locator-card ${loc.isRecommended ? 'recommended' : 'unique'}`;
    div.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
        <code style="flex: 1;">${loc.code}</code>
        <button class="copy-btn" style="background: var(--accent); color: white; border: none; border-radius: 4px; padding: 4px 8px; cursor: pointer; font-size: 11px; white-space: nowrap;">📋 Copy</button>
      </div>
      ${loc.isRecommended ? '<span class="badge" style="background: gold; color: black; margin-top: 8px; display: inline-block;">★ Recommended</span>' : ''}
    `;
    const copyBtn = div.querySelector('.copy-btn') as HTMLButtonElement;
    copyBtn.addEventListener('click', (e) => { e.stopPropagation(); void copyToClipboard(loc.code, copyBtn); });
    div.addEventListener('click', () => { void copyToClipboard(loc.code); });
    locatorList.appendChild(div);
  });
}

recordBtn.addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null || !tab.url) return;
  currentTabUrl = tab.url;

  if (isRecording) {
    isRecording = false;
    recordBtn.textContent = '⏺ Start Recording';
    recordBtn.style.background = 'var(--accent)';
    assertToggle.checked = false;
    await chrome.runtime.sendMessage({ type: 'STOP_RECORDING', tabId: tab.id } as RuntimeMessage);
  } else {
    isRecording = true;
    recordedActions = [];
    rawTestCodeBox.value = '';
    testCodeBox.value = '';
    pageCodeBox.value = '';
    recordBtn.textContent = '🛑 Stop Recording';
    recordBtn.style.background = 'var(--warning)';
    
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => sessionStorage.removeItem('locatorHealerRecording')
    });

    await chrome.runtime.sendMessage({ type: 'START_RECORDING', tabId: tab.id, testIdAttribute: 'data-testid', language: 'javascript' } as RuntimeMessage);
  }
});

assertToggle.addEventListener('change', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id == null) return;
  await chrome.runtime.sendMessage({ type: 'TOGGLE_ASSERTION_MODE', tabId: tab.id, isAssertionMode: assertToggle.checked } as RuntimeMessage);
});

function closeModal() { assertionModal.style.display = 'none'; pendingAssertionTarget = null; }
assertCancelBtn.addEventListener('click', closeModal);

function addAssertion(actionType: any) {
  if (!pendingAssertionTarget) return;
  recordedActions.push({
    type: 'assertion',
    actionType,
    locatorCode: pendingAssertionTarget.locatorCode,
    tagName: pendingAssertionTarget.tagName,
    text: pendingAssertionTarget.text,
    value: pendingAssertionTarget.value
  });
  closeModal();
  generateCode();
}

assertVisibleBtn.addEventListener('click', () => addAssertion('assert_visible'));
assertEnabledBtn.addEventListener('click', () => addAssertion('assert_enabled'));
assertTextBtn.addEventListener('click', () => addAssertion('assert_text'));
assertValueBtn.addEventListener('click', () => addAssertion('assert_value'));

function getVarName(locatorCode: string, tagName: string, text?: string): string {
  try {
    let base = '';
    if (locatorCode.includes('getByRole')) {
      const nameMatch = locatorCode.match(/name:\s*['"](.+?)['"]/)?.[1];
      const roleMatch = locatorCode.match(/getByRole\(['"](.+?)['"]/)?.[1];
      if (nameMatch) base = nameMatch;
      else base = roleMatch || 'element';
    } else if (locatorCode.includes('getByLabel') || locatorCode.includes('getByPlaceholder')) {
      base = locatorCode.match(/['"](.+?)['"]\)$/)?.[1] || 'input';
    } else if (locatorCode.includes('getByText')) {
      base = locatorCode.match(/getByText\(['"](.+?)['"]/)?.[1] || 'text';
    } else if (locatorCode.includes('hasText:')) {
      base = locatorCode.match(/hasText:\s*['"](.+?)['"]/)?.[1] || 'item';
    } else if (locatorCode.includes('normalize-space()=')) {
      base = locatorCode.match(/normalize-space\(\)\s*=\s*['"](.+?)['"]/)?.[1] || 'text';
    } else if (text && text.length > 0 && text.length < 25) {
      base = text;
    } else {
      base = tagName || 'element';
    }

    let clean = base.replace(/[^a-zA-Z0-9\s]/g, '').trim();
    if (clean.length > 25) clean = clean.substring(0, 25); 
    
    const words = clean.split(/\s+/);
    if (words.length === 0) return 'element';
    
    const camelCase = words.map((w, i) => i === 0 ? w.toLowerCase() : w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join('');
    
    if (tagName === 'input' || tagName === 'textarea') return camelCase + 'Input';
    if (tagName === 'button' || locatorCode.includes('button')) return camelCase + 'Btn';
    if (tagName === 'a' || locatorCode.includes('link') || locatorCode.includes('menuitem')) return camelCase + 'Link';
    
    return camelCase;
  } catch {
    return 'element';
  }
}

function generateCode() {
  try {
    // 1. Filter out redundant hovers and clicks
    const actionWithoutHover = recordedActions.filter((act, index) => {
      if (act.actionType === 'hover') {
        const hasLaterClick = recordedActions.slice(index + 1).some(later => 
          later.locatorCode === act.locatorCode && later.actionType === 'click'
        );
        if (hasLaterClick) return false;
      }
      return true;
    });

    const filteredActions = actionWithoutHover.filter((act, index) => {
      if (act.actionType === 'click') {
        const nextAct = actionWithoutHover[index + 1];
        if (nextAct && nextAct.locatorCode === act.locatorCode && nextAct.actionType === 'fill') return false;
      }
      return true;
    });

    // ─── 1. GENERATE RAW TEST FILE ───
    let rawTestCode = `import { test, expect } from '@playwright/test';\n\n`;
    rawTestCode += `test('Raw Recorded Flow', async ({ page }) => {\n  await page.goto('${currentTabUrl || '/'}');\n\n`;

    filteredActions.forEach((act) => {
      let baseLocator = act.locatorCode.replace(/^page\./, '');
      if (act.isIframe) baseLocator = `page.frameLocator('iframe').${baseLocator}`;
      else baseLocator = `page.${baseLocator}`;

      if (act.type === 'action') {
        if (act.actionType === 'fill') {
          if (act.isDateField) {
            rawTestCode += `  const dateStr = new Date(new Date().setMonth(new Date().getMonth() + 2)).toISOString().split('T')[0];\n`;
            rawTestCode += `  await ${baseLocator}.fill(dateStr);\n`;
          } else {
            rawTestCode += `  await ${baseLocator}.fill('${act.value}');\n`;
          }
        } else if (act.actionType === 'select') {
          rawTestCode += `  await ${baseLocator}.selectOption('${act.value}');\n`;
        } else if (act.actionType === 'click') {
          rawTestCode += `  await ${baseLocator}.click();\n`;
        } else if (act.actionType === 'hover') {
          rawTestCode += `  await ${baseLocator}.hover();\n`;
        } else if (act.actionType === 'press') {
          rawTestCode += `  await ${baseLocator}.press('${act.value}');\n`;
        }
      } else if (act.type === 'assertion') {
        if (act.actionType === 'assert_visible') rawTestCode += `  await expect(${baseLocator}).toBeVisible();\n`;
        if (act.actionType === 'assert_enabled') rawTestCode += `  await expect(${baseLocator}).toBeEnabled();\n`;
        if (act.actionType === 'assert_text') rawTestCode += `  await expect(${baseLocator}).toHaveText('${act.text?.replace(/'/g, "\\'")}');\n`;
        if (act.actionType === 'assert_value') rawTestCode += `  await expect(${baseLocator}).toHaveValue('${act.value?.replace(/'/g, "\\'")}');\n`;
      }
    });
    rawTestCode += `});\n`;
    rawTestCodeBox.value = rawTestCode;


    // ─── 2. GENERATE POM TEST & PAGE FILE ───
    interface ActionMethod {
      name: string;
      params: string[];
      steps: string[];
      isAssertion?: boolean;
    }
    const methods: ActionMethod[] = [];
    let currentMethod: ActionMethod | null = null;
    const usedVarNames = new Set<string>();
    const locatorMap = new Map<string, string>();

    const getLocatorVar = (locatorCode: string, tagName: string, text?: string) => {
      if (locatorMap.has(locatorCode)) return locatorMap.get(locatorCode)!;
      let varName = getVarName(locatorCode, tagName, text);
      let counter = 1;
      while (usedVarNames.has(varName)) { varName = varName + counter++; }
      usedVarNames.add(varName);
      locatorMap.set(locatorCode, varName);
      return varName;
    };

    filteredActions.forEach((act, index) => {
      const varName = getLocatorVar(act.locatorCode, act.tagName, act.text);

      if (act.type === 'action') {
        if (!currentMethod) {
          let methodName = 'performAction';
          if (act.actionType === 'click') methodName = `click${varName.charAt(0).toUpperCase() + varName.slice(1)}`;
          else if (varName.toLowerCase().includes('password') || varName.toLowerCase().includes('username')) methodName = 'login';
          else if (varName.toLowerCase().includes('search')) methodName = 'search';
          else methodName = `fill${varName.charAt(0).toUpperCase() + varName.slice(1)}`;

          currentMethod = { name: methodName, params: [], steps: [] };
        }

        if (act.actionType === 'fill') {
          const paramName = varName.replace(/Input$/, '') || 'value';
          if (!currentMethod.params.includes(paramName)) currentMethod.params.push(paramName);
          currentMethod.steps.push(`await this.${varName}.fill(${paramName});`);
        } else if (act.actionType === 'click') {
          currentMethod.steps.push(`await this.${varName}.click();`);
          methods.push(currentMethod);
          currentMethod = null;
        } else if (act.actionType === 'hover') {
          currentMethod.steps.push(`await this.${varName}.hover();`);
        } else if (act.actionType === 'press') {
          currentMethod.steps.push(`await this.${varName}.press('${act.value}');`);
        }
      } else {
        if (currentMethod) { methods.push(currentMethod); currentMethod = null; }
        
        let assertionCode = '';
        if (act.actionType === 'assert_visible') assertionCode = `await expect(pom.${varName}).toBeVisible();`;
        if (act.actionType === 'assert_enabled') assertionCode = `await expect(pom.${varName}).toBeEnabled();`;
        if (act.actionType === 'assert_text') assertionCode = `await expect(pom.${varName}).toHaveText('${act.text?.replace(/'/g, "\\'")}');`;
        if (act.actionType === 'assert_value') assertionCode = `await expect(pom.${varName}).toHaveValue('${act.value?.replace(/'/g, "\\'")}');`;
        
        methods.push({ name: 'assertion_' + index, params: [], steps: [assertionCode], isAssertion: true });
      }
    });
    if (currentMethod) methods.push(currentMethod);

    // Generate POM File
    let pageCode = `import { expect } from '@playwright/test';\n\nexport class RecordedPage {\n  /**\n   * @param {import('@playwright/test').Page} page\n   */\n  constructor(page) {\n    this.page = page;\n`;
    locatorMap.forEach((varName, locatorCode) => {
      pageCode += `    this.${varName} = page.${locatorCode};\n`;
    });
    pageCode += `  }\n\n`;
    pageCode += `  async navigate() {\n    await this.page.goto('${currentTabUrl || '/'}');\n  }\n\n`;
    methods.forEach(m => {
      if (m.isAssertion) return;
      const paramsStr = m.params.join(', ');
      pageCode += `  async ${m.name}(${paramsStr}) {\n`;
      m.steps.forEach(step => { pageCode += `    ${step}\n`; });
      pageCode += `  }\n\n`;
    });
    pageCode += `}\n`;

    // Generate Framework Test File
    let testCode = `import { test, expect } from '@playwright/test';\nimport { RecordedPage } from './RecordedPage';\n\n`;
    testCode += `test('Recorded Flow', async ({ page }) => {\n  const pom = new RecordedPage(page);\n  await pom.navigate();\n\n`;
    methods.forEach(m => {
      if (m.isAssertion) {
        testCode += `  ${m.steps[0]}\n`;
      } else {
        const args = m.params.map(p => `'PLACEHOLDER_${p.toUpperCase()}'`).join(', ');
        testCode += `  await pom.${m.name}(${args});\n`;
      }
    });
    testCode += `});\n`;

    testCodeBox.value = testCode;
    pageCodeBox.value = pageCode;

  } catch (e) {
    console.error('Code generation failed', e);
  }
}

copyRawTestBtn.addEventListener('click', () => void copyToClipboard(rawTestCodeBox.value, copyRawTestBtn));
copyTestBtn.addEventListener('click', () => void copyToClipboard(testCodeBox.value, copyTestBtn));
copyPageBtn.addEventListener('click', () => void copyToClipboard(pageCodeBox.value, copyPageBtn));

chrome.runtime.onMessage.addListener((message: RuntimeMessage) => {
  if (message.type === 'PICK_RESULT') {
    resultsSection.style.display = 'block';
    renderLocators(message.locators);
  } else if (message.type === 'PICK_CANCELLED') {
    isPickingMode = false;
    pickBtn.textContent = '🎯 Pick Element';
    pickBtn.style.background = 'var(--accent)';
  } else if (message.type === 'ACTION_RECORDED') {
    recordedActions.push(message.action);
    generateCode();
  } else if (message.type === 'ASSERTION_TARGET_PICKED') {
    pendingAssertionTarget = message;
    assertionModal.style.display = 'block';
    assertTextBtn.style.display = message.text ? 'block' : 'none';
    assertValueBtn.style.display = message.value ? 'block' : 'none';
  }
});