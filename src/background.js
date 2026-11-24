// AdLint Pocket service worker: toolbar button opens the side panel; right-click sends selected text to it.

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'adlint-check-selection',
    title: 'Check with AdLint Pocket',
    contexts: ['selection'],
  });
});

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== 'adlint-check-selection' || !info.selectionText) return;
  // Open first (needs the user gesture), then hand the text over through session storage.
  await chrome.sidePanel.open({ windowId: tab.windowId });
  await chrome.storage.session.set({ pendingText: info.selectionText });
});
