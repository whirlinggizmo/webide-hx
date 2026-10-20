// The all-in-one extension's worker: the toolbar button opens the IDE (index.html, the same
// page as the web IDE's, assembled by build.py --extension), or shows the tab it's in
chrome.action.onClicked.addListener(async () => {
  const url = chrome.runtime.getURL("index.html");
  const [tab] = await chrome.tabs.query({ url });
  if (tab) { await chrome.tabs.update(tab.id, { active: true }); await chrome.windows.update(tab.windowId, { focused: true }); }
  else await chrome.tabs.create({ url });
});
