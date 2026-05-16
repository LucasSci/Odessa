const { chromium } = require('playwright');

(async () => {
  try {
    // Connect to an existing Chrome browser instance running with remote debugging
    // User must start Chrome with: chrome.exe --remote-debugging-port=9222
    const browser = await chromium.connectOverCDP('http://localhost:9222');

    // Get the first context and its pages
    const context = browser.contexts()[0];
    const pages = context.pages();

    // Find the page that contains 'tango' in the URL (adjust if necessary)
    const tangoPage = pages.find((page) => page.url().toLowerCase().includes('tango'));

    if (!tangoPage) {
      console.error('Tango page not found. Ensure a logged-in Tango tab is open in the browser.');
      await browser.close();
      return;
    }

    // Selector for the chat input field (placeholder - may need adjustment based on Tango's UI)
    const inputSelector =
      'input[placeholder*="message" i], textarea[placeholder*="message" i], [data-testid*="chat-input"], #chat-input';

    // Wait for the input field to be visible
    await tangoPage.waitForSelector(inputSelector, { timeout: 10000 });

    // Click on the input field
    await tangoPage.click(inputSelector);

    // Type the test message
    const testMessage = 'Test message from automation script';
    await tangoPage.fill(inputSelector, testMessage);

    // Press Enter to send the message
    await tangoPage.press(inputSelector, 'Enter');

    console.log('Message sent successfully:', testMessage);

    // Close the browser connection
    await browser.close();
  } catch (error) {
    console.error('Error occurred:', error.message);
  }
})();
