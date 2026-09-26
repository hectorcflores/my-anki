# My Anki Kindle extension

The extension reads one Kindle book from the Amazon notebook open in the
user's normal Chrome browser. It stores a durable local batch, opens My Anki's
authenticated importer and sends the highlights to the owner's private
Firestore path. Amazon cookies and passwords never leave Amazon's page.

## Install for the pilot

1. Open `chrome://extensions` in Google Chrome.
2. Turn on **Developer mode**.
3. Choose **Load unpacked** and select this `extension` folder.
4. Open `https://read.amazon.com/notebook` and sign into Amazon directly if
   Amazon asks. Credentials stay on Amazon's page.
5. Open the extension and choose **Sync recent books**.

The extension only collects while the Kindle notebook is the active tab. A
successful import is marked **Updated** only after Firestore accepts the batch.
The batch id is derived from its content, so retrying the same batch cannot
create a second import document.

## Check before upload work

Run from this folder:

```sh
node test/extract.test.mjs
node --check background.js
node --check content.js
node --check popup.js
```
