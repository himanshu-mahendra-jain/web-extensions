import { applyPlaybackSpeed } from "../src/page.js";


/*
 * Adds a muted, looping <video> that plays generated silence, so the
 * page has media that is really playing (not paused, enough data
 * buffered). Muted video may autoplay without a user gesture; audio
 * may not. Runs in the page: pass it to page.evaluate() or inline it
 * into a <script> with playingVideoScript().
 */
export function addPlayingVideo(rate) {
  const sampleRate = 8000;
  const samples = sampleRate * 5;
  const wav = new DataView(new ArrayBuffer(44 + samples * 2));

  const writeText = (offset, text) => {
    for (let index = 0; index < text.length; index++) {
      wav.setUint8(offset + index, text.charCodeAt(index));
    }
  };

  // 16-bit mono PCM WAV header; the samples stay zero.
  writeText(0, "RIFF");
  wav.setUint32(4, 36 + samples * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  wav.setUint32(16, 16, true);
  wav.setUint16(20, 1, true);
  wav.setUint16(22, 1, true);
  wav.setUint32(24, sampleRate, true);
  wav.setUint32(28, sampleRate * 2, true);
  wav.setUint16(32, 2, true);
  wav.setUint16(34, 16, true);
  writeText(36, "data");
  wav.setUint32(40, samples * 2, true);

  const video = document.createElement("video");

  video.dataset.playing = "";
  video.src = URL.createObjectURL(
    new Blob([wav.buffer], { type: "audio/wav" })
  );
  video.muted = true;
  video.loop = true;

  // Setting src resets the rate, so the rate is set afterwards.
  video.defaultPlaybackRate = rate;
  video.playbackRate = rate;

  document.body.append(video);

  return video.play();
}


export function playingVideoScript(rate) {
  return `<script>(${addPlayingVideo})(${rate});</script>`;
}


// True once every video added by addPlayingVideo() in the frame plays.
export function videosArePlaying() {
  return [...document.querySelectorAll("video[data-playing]")].every((video) => {
    return !video.paused && video.readyState > 2;
  });
}


/*
 * Shows a white player <div> fullscreen, as a site's fullscreen button
 * does. A Playwright click is the user gesture fullscreen needs.
 */
export async function enterFullscreenPlayer(page) {
  await page.setContent(`
    <div id="player" style="background: #ffffff">
      <button>Fullscreen</button>
    </div>
    <script>
      document.querySelector("button").onclick = () => {
        document.getElementById("player").requestFullscreen();
      };
    </script>
  `);

  await page.click("button");
  await page.waitForFunction(() => document.fullscreenElement !== null);
}


/*
 * A script that shows the on-page indicator at speed, as the extension
 * does in English, for page.evaluate() or a tab's evaluate().
 */
export function indicatorScript(speed) {
  const labels = {
    shown: `${speed}x`,
    spoken: `Playback speed ${speed} times`,
    lang: "en",
    dir: "ltr"
  };

  return `(${applyPlaybackSpeed})(${speed}, ${JSON.stringify(labels)})`;
}
