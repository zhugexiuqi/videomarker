// 安装或更新时触发
chrome.runtime.onInstalled.addListener(() => {
  console.log('扩展已安装');
});