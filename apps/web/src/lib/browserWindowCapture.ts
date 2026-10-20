export type BrowserWindowCaptureResult =
  | { readonly status: "captured"; readonly file: File }
  | { readonly status: "cancelled" }
  | { readonly status: "unsupported" }
  | { readonly status: "failed"; readonly message: string };

export const supportsBrowserWindowCapture = (): boolean =>
  typeof navigator !== "undefined" && typeof navigator.mediaDevices?.getDisplayMedia === "function";

const waitForFirstFrame = (video: HTMLVideoElement): Promise<void> =>
  new Promise((resolve, reject) => {
    video.addEventListener("loadeddata", () => resolve(), { once: true });
    video.addEventListener(
      "error",
      () => reject(new Error("The captured window could not be read.")),
      { once: true },
    );
  });

const canvasToPngFile = (canvas: HTMLCanvasElement, name: string): Promise<File> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error("The capture could not be encoded."));
      else resolve(new File([blob], name, { type: "image/png" }));
    }, "image/png");
  });

/** Asks the browser which window to share and returns one frame as a PNG file. */
export async function captureBrowserWindow(
  now: Date = new Date(),
): Promise<BrowserWindowCaptureResult> {
  if (!supportsBrowserWindowCapture()) return { status: "unsupported" };
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === "NotAllowedError") {
      return { status: "cancelled" };
    }
    return {
      status: "failed",
      message: cause instanceof Error ? cause.message : "Capture failed.",
    };
  }
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.srcObject = stream;
    const ready = waitForFirstFrame(video);
    await video.play();
    await ready;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const context = canvas.getContext("2d");
    if (context === null) return { status: "failed", message: "Canvas is unavailable." };
    context.drawImage(video, 0, 0);
    const stamp = now.toISOString().replace(/[:.]/g, "-");
    return { status: "captured", file: await canvasToPngFile(canvas, `capture-${stamp}.png`) };
  } catch (cause) {
    return {
      status: "failed",
      message: cause instanceof Error ? cause.message : "Capture failed.",
    };
  } finally {
    for (const track of stream.getTracks()) track.stop();
  }
}
