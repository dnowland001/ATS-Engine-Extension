# ATS Engine extensions in Safari (Mac, iPhone, iPad)

Safari extensions are delivered inside a small app through the App Store.
The extension itself is the same code: `node scripts/build.mjs --safari --zip`
makes `dist/safari/ats-engine-seeker-<version>-safari.zip` and
`dist/safari/ats-engine-recruiter-<version>-safari.zip`. Apple's converter
turns each folder into an Xcode project, and that has to be done on a Mac.

## You need

1. A Mac with **Xcode** (free, from the Mac App Store).
2. An **Apple Developer Program** membership ($99 a year) to publish to the App Store.

## On the Mac, for each extension

1. Unzip `ats-engine-seeker-0.5.6-safari.zip` into a folder called `ats-engine-seeker` in your home folder.
2. Open **Terminal** and run (one line):

   ```
   xcrun safari-web-extension-converter ~/ats-engine-seeker --app-name "ATS Engine - Seekers" --bundle-identifier com.atsengine.seekers --swift --copy-resources
   ```

   For Recruiters: folder `ats-engine-recruiter`, app name `ATS Engine - Recruiters`, bundle identifier `com.atsengine.recruiters`.
3. Xcode opens the project, with a macOS app and an iOS app (iPhone and iPad).
4. For every target, open **Signing & Capabilities** and choose your **Team**.
5. Try it on the Mac: press Run, then in Safari choose Settings > Extensions and switch it on.
   (While testing an unsigned build: Safari > Settings > Advanced > "Show features for web developers",
   then Develop > "Allow unsigned extensions".)
6. Publish: choose **Any Mac** as the destination, then Product > Archive > Distribute App > App Store Connect.
   Then choose **Any iOS Device** and archive again for iPhone and iPad.
7. In **App Store Connect** (appstoreconnect.apple.com), finish the app's page: description (the Chrome/Edge text works),
   screenshots, privacy policy URL `https://www.ats-engine.com/privacy`, and the same review notes as Firefox
   (reviewers start the free trial at https://app.ats-engine.com and press Connect).

## How it connects

Safari, like Firefox, gives every install a random address and does not let the
Connect page message the extension. So the Safari build connects with a one-time
secret through the small script on the Connect page, under the fixed connect IDs
`ats-engine-seekers@ats-engine.com` and `recruiters@ats-engine.com`
(ATS Engine's `config/extension.php` `firefox_ids`). No server change is needed
per install. Seekers opens as a pop-up in Safari (no side panel); the job stays
pinned while you apply.
