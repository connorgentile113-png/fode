# Sign and install in regular Firefox

Release Firefox requires a Mozilla-signed extension for permanent installation. Temporary loading through `about:debugging` lasts only until Firefox exits. Fode does not disable signature verification or modify your browser profile.

1. Create or sign into your [Mozilla Add-ons developer account](https://addons.mozilla.org/developers/).
2. Choose **Submit a New Add-on**, then **On your own** for an unlisted, self-distributed add-on.
3. Upload `dist/fode_chatgpt_terminal_bridge-0.1.0.zip`, produced by `npm run build`. The extension has no build/transpilation step; `extension/` contains its complete source. If Mozilla requests source, provide that directory.
4. Complete Mozilla's review and data-use disclosures. This extension sends user-directed chat content and terminal results to ChatGPT/Codex. It has native terminal access through the separately installed Linux harness. Do not describe it as collecting no data.
5. Download Mozilla's signed `.xpi`. In Firefox open `about:addons`, choose the gear menu → **Install Add-on From File**, and select the signed file. Accept Firefox's permission prompt.
6. Run `npm run install:local` if the native host/service is not already installed. The toolbar badge should show ON.

For CLI signing, [web-ext sign](https://extensionworkshop.com/documentation/develop/web-ext-command-reference/#web-ext-sign) accepts `WEB_EXT_API_KEY` and `WEB_EXT_API_SECRET` environment variables from Mozilla's API credentials page. Keep them out of this repository and shell history. With those variables already securely set:

```sh
npx web-ext sign --source-dir extension --channel unlisted --artifacts-dir dist
```

Never commit signing credentials, account cookies, or Codex auth files. The public GitHub package is **unsigned** until you explicitly upload a signed release asset. A public repository does not imply Mozilla signing or review approval.

For updates, bump `extension/manifest.json` and `package.json`, rerun tests and build, sign the new version, then install its signed XPI. Automated self-hosted extension updates are not configured in v0.1.0.

Reference: [Mozilla signing and distribution overview](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/).
