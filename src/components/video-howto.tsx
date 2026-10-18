import type { Platform } from "@/lib/social";

/** One short line shown under a post whose link has been recognised. */
export const PLATFORM_TIP: Record<Platform, string> = {
  tiktok:
    "Tip: in TikTok tap Share → Save video, then upload that video here. If there’s no Save video button, screen-record it instead.",
  instagram:
    "Tip: Instagram usually can’t save other people’s posts. Screen-record the post while it plays, then upload the recording here.",
  xiaohongshu:
    "Tip: in Xiaohongshu tap Share → look for Save video. If it isn’t there, screen-record the post, then upload the recording here.",
};

/** Plain, step-by-step help for getting a video file from a social app. */
export function VideoHowTo() {
  return (
    <details className="howto">
      <summary>How do I get the video? (easy steps)</summary>

      <p>
        We can’t take a video from a link. You need to put a copy of it on your
        phone or computer first, then upload it here. It takes about a minute.
      </p>

      <h3>Step 1 — Get the video onto your device</h3>
      <p>Pick the easiest way for the app you’re using:</p>
      <ul>
        <li>
          <strong>TikTok:</strong> open the video, tap <em>Share</em> (the
          arrow), then <em>Save video</em>. If you can’t see “Save video”, the
          creator has turned it off — use the screen recording below.
        </li>
        <li>
          <strong>Instagram:</strong> open the post or reel and tap{" "}
          <em>Share</em> (the paper plane). If you see <em>Download</em>, tap
          it. Most posts don’t have it — use the screen recording below.
        </li>
        <li>
          <strong>Xiaohongshu (小红书):</strong> open the post, tap{" "}
          <em>Share</em>, and look for <em>Save video</em> (保存视频). If it
          isn’t there, use the screen recording below.
        </li>
      </ul>

      <h3>No save button? Record your screen instead</h3>
      <ul>
        <li>
          <strong>iPhone:</strong> swipe down from the top-right corner of the
          screen to open Control Center and tap the round <em>Record</em>{" "}
          button. After the 3-second countdown, open the post and let it play.
          When it finishes, tap the red bar at the top and choose Stop. The
          recording is saved in your Photos.
        </li>
        <li>
          <strong>Android:</strong> swipe down twice from the top, tap{" "}
          <em>Screen record</em> (it may be called Screen recorder), and tap
          Start. Play the post, then stop the recording from the notification.
          It’s saved in your Gallery.
        </li>
        <li>
          <strong>Computer:</strong> on a Mac press Shift + Command + 5; on
          Windows 11 press Windows + Shift + R. Choose the part of the screen
          with the video, then start recording.
        </li>
      </ul>

      <h3>Step 2 — Upload it here</h3>
      <ol>
        <li>
          Paste the post’s link in the box above (we keep it as your source).
        </li>
        <li>
          Press <em>+ Upload screenshots or a screen recording</em> under it and
          choose the video from your Photos or Gallery.
        </li>
        <li>
          Wait a few seconds while we prepare it. You’ll see “Heard … phrases”
          if we could make out the words that were said.
        </li>
        <li>
          Press <em>Find places</em>.
        </li>
      </ol>

      <h3>To get the best result</h3>
      <ul>
        <li>
          <strong>Turn the sound on</strong> and don’t mute your phone. We
          listen for place names that are said out loud.
        </li>
        <li>
          <strong>Let the place name show</strong> on screen for a few seconds —
          the location tag, a sign, or the caption.
        </li>
        <li>
          <strong>Keep it under 2 minutes.</strong> We only use the first 2
          minutes.
        </li>
        <li>
          <strong>Short on time?</strong> Screenshots work too. Pause on the
          location tag or caption and take a screenshot.
        </li>
        <li>
          <strong>Privacy:</strong> turn on Do Not Disturb before recording so
          messages don’t pop up. The video itself stays on your device — only a
          few still pictures and the sound are sent to be read.
        </li>
      </ul>

      <p className="hint">
        A place is marked <strong>Confirmed</strong> when we both hear it and
        see it, so videos that show the name <em>and</em> say it work best.
      </p>
    </details>
  );
}
