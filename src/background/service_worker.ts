import type { RuntimeMessage, TabMessage } from '../shared/messages';

// Keep track of which tabs are currently recording
const activeRecordingTabs = new Map<number, { testIdAttribute: string; language: string }>();

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);
});

chrome.runtime.onMessage.addListener((message: RuntimeMessage) => {
  if (message.type === 'START_PICK') {
    void chrome.tabs.sendMessage(message.tabId, { type: 'START_PICK', language: message.language, testIdAttribute: message.testIdAttribute } as TabMessage).catch(console.error);
  } else if (message.type === 'STOP_PICK') {
    void chrome.tabs.sendMessage(message.tabId, { type: 'STOP_PICK' } as TabMessage).catch(console.error);
  } 
  
  // 🎥 RECORDER BRIDGE
  else if (message.type === 'START_RECORDING') {
    activeRecordingTabs.set(message.tabId, { testIdAttribute: message.testIdAttribute, language: message.language });
    void chrome.tabs.sendMessage(message.tabId, { type: 'START_RECORDING', testIdAttribute: message.testIdAttribute, language: message.language } as TabMessage).catch(console.error);
  } else if (message.type === 'STOP_RECORDING') {
    activeRecordingTabs.delete(message.tabId);
    void chrome.tabs.sendMessage(message.tabId, { type: 'STOP_RECORDING' } as TabMessage).catch(console.error);
  } else if (message.type === 'TOGGLE_ASSERTION_MODE') {
    void chrome.tabs.sendMessage(message.tabId, { type: 'TOGGLE_ASSERTION_MODE', isAssertionMode: message.isAssertionMode } as TabMessage).catch(console.error);
  }
  return false;
});

// 🚀 MAGIC FIX: Re-attach the recorder when the page navigates to a new URL!
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete' && activeRecordingTabs.has(tabId)) {
    const settings = activeRecordingTabs.get(tabId)!;
    
    // Wait a tiny bit for the page to settle, then tell the new page to start recording
    setTimeout(() => {
      chrome.tabs.sendMessage(tabId, { 
        type: 'START_RECORDING', 
        testIdAttribute: settings.testIdAttribute, 
        language: settings.language 
      } as TabMessage).catch(() => {
        // Ignore errors if the tab was closed
      });
    }, 500);
  }
});