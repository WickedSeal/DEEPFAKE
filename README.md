# Trustlock Message Guard for Chrome

Trustlock Message Guard monitors rendered messages in Gmail Web and Telegram Web. It learns a local, per-sender writing baseline from history currently loaded in the open conversation, compares newly observed messages with that baseline, and raises Chrome notifications for review signals. Alert summaries appear in the existing Trustlock **Live Stream Feed**. You can also right-click a web image and choose **Analyze image with Trustlock** to screen it with the project's still-image model.

## Install the ZIP

1. Extract `Trustlock-Message-Guard.zip` to a folder.
2. Open `chrome://extensions` in Chrome and turn on **Developer mode**.
3. Choose **Load unpacked** and select the extracted `extension` folder (the folder containing `manifest.json`).
4. Start the Trustlock backend and frontend using the project setup instructions. The backend should be reachable at `http://127.0.0.1:8000`.
5. Open a Gmail or Telegram Web conversation, then click the Trustlock toolbar icon. Approve Chrome's site and local Trustlock permissions. The same toolbar button turns monitoring off.
6. Reload the site tab if Chrome reports that a content script could not be injected.

## Analyze an image from a web page

1. Start the local Trustlock backend and make sure an image screening model checkpoint is installed under the configured model weights directory.
2. Right-click a visible image and choose **Analyze image with Trustlock**.
3. On first use, approve access to the local Trustlock API. The extension captures the visible tab temporarily, crops it to the selected image in memory, and sends only the resized image crop to `127.0.0.1:8000`.
4. Read the result in the focused Trustlock extension popup window. It shows an AI-like model signal, the model's observations, and limitations.

The image must be visible in the browser viewport; this method also works with images delivered through temporary `blob:` URLs or authenticated image CDNs because it analyzes the displayed crop instead of fetching the source URL. Only the selected image crop is sent to the backend; the rest of the captured screen stays in browser memory. The extension submits a resized JPEG of at most 4 MB. The backend analyzes it in a temporary directory and does not attach it to an investigation or retain the image.

An image is one still frame. The score is an AI-like model screening signal, not a calibrated probability, proof of a deepfake, or proof of a person's identity. It does not check temporal consistency, liveness, or lip-sync. A missing model checkpoint returns an unavailable result instead of pretending to detect a deepfake.

This ZIP is for local unpacked installation. Chrome Web Store publication requires a developer account, a privacy policy, and store review; it is not included here.

## How history-based analysis works

- When monitoring is enabled in an open conversation, the extension learns from incoming messages already rendered by the site. At least 10 messages are required before a behavior deviation score is shown.
- Baselines are separate by app and sender identity. The extension stores aggregate writing statistics, intent counts, and hashed message identifiers in Chrome local storage; it does not store the learned message bodies there.
- The extension observes newly added messages while the monitored page is open. It does not monitor while Chrome is closed, and it cannot read messages that Gmail/Telegram has not rendered or loaded.
- Gmail inbox rows expose only a subject and snippet. Open a thread to provide full message history. Telegram history may require scrolling to load older messages before enabling monitoring.
- Behavior deviation is a heuristic review signal based on message length, word length, capitalization, digits, punctuation, and intent changes. It is not an identity proof or calibrated probability. Urgency and intent are reported separately.
- Alerts are raised for messages with strong urgency, sensitive intent, or a high behavior deviation. A high alert does not authorize blocking, transferring, replying, or any other action.

## Data and permissions

The extension requests access only to the Gmail or Telegram site where you click its toolbar button, plus the local Trustlock API. The analysis and behavior profiles run locally in the extension. For flagged messages, the extension sends the source app, sender label, up to 500 characters of message preview, intent, urgency score, behavior score, baseline count, and indicators to the local backend. Those alert summaries are stored in the Trustlock database and displayed in the existing Live Stream Feed. No messages are sent to a third-party service by this extension.

Click the toolbar icon on the monitored site to stop monitoring; disabling the final site also revokes the extension's local API permission. To delete learned sender profiles, remove the extension's local data from Chrome's extension storage controls or remove the extension.

## Current scope and validation

This is a local integration for Gmail Web and Telegram Web, not an organization-managed production release. Gmail and Telegram change their page markup, so selectors must be validated against current authenticated Chrome sessions. The extension processes only visible/rendered page content, and no test in this workspace can certify behavior against a real account. Keep Trustlock bound to localhost; the ingestion endpoint rejects non-loopback clients.
