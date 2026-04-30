# Tango Live Chat Automation Script

This script automates sending messages in the Tango live chat using Playwright.

## Prerequisites

- Node.js installed
- Google Chrome browser
- A logged-in session in Tango (open the Tango live page in Chrome)

## Setup

1. Install dependencies:
   ```
   npm install
   ```

2. Start Chrome with remote debugging enabled:
   - Close all Chrome instances
   - Open Command Prompt and run:
     ```
     "C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
     ```
   - Log in to Tango and navigate to the live chat page in this Chrome instance

## Usage

Run the script:
```
npm start
```
or
```
node send_message.js
```

The script will:
- Connect to the running Chrome instance
- Find the Tango page
- Locate the chat input field
- Send a test message: "Test message from automation script"

## Notes

- The input selector is a placeholder and may need adjustment based on Tango's actual UI structure. Inspect the chat input element in Chrome DevTools to find the correct selector.
- Ensure the Tango page is loaded and the chat is accessible.
- The script assumes the first matching page with 'tango' in the URL is the correct one.

## Troubleshooting

- If the script cannot find the Tango page, check that the URL contains 'tango'.
- If the input field is not found, update the `inputSelector` in `send_message.js` with the correct CSS selector.