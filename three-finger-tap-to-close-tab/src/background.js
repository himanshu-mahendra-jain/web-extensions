import './extension-api.js';

const closingTabs = new Set();

function closeTab(tabId) {
  if (!Number.isInteger(tabId) || closingTabs.has(tabId)) return;

  closingTabs.add(tabId);

  // Fails only when the tab is already closed.
  extensionApi.tabs
    .remove(tabId)
    .catch(() => { })
    .finally(() => closingTabs.delete(tabId));
}

extensionApi.runtime.onMessage.addListener((message, sender) => {
  if (message?.type !== 'CLOSE_TAB') return;

  closeTab(sender.tab?.id);
});

extensionApi.action.onClicked.addListener((tab) => {
  closeTab(tab.id);
});