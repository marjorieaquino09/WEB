// js/scanner.js
// Shared na barcode scanner para sa inventory.js at checkout.js.
// Kailangang naka-load na sa HTML ang html5-qrcode (global `Html5Qrcode`).

let html5QrCode = null;
let starting = false;

function supportedFormats() {
  const F = Html5QrcodeSupportedFormats;
  return [
    F.EAN_13,
    F.EAN_8,
    F.UPC_A,
    F.UPC_E,
    F.CODE_128,
    F.CODE_39,
    F.CODE_93,
    F.ITF,
    F.CODABAR
  ];
}

// Tanggalin ang spaces at leading zeros para magtugma ang UPC-A (12 digits)
// at EAN-13 (13 digits na may 0 sa unahan).
export function normalizeBarcode(code) {
  return String(code || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/^0+(?=\d)/, "");
}

export function sameBarcode(a, b) {
  const x = normalizeBarcode(a);
  const y = normalizeBarcode(b);
  return !!x && x === y;
}

// Back/rear camera muna (phone). Kung wala, ang unang camera (laptop webcam).
async function pickCameraId() {
  const devices = await Html5Qrcode.getCameras();
  if (!devices || !devices.length) throw new Error("NO_CAMERA");
  const back = devices.find((d) => /back|rear|environment/i.test(d.label));
  return (back || devices[0]).id;
}

export function isScannerRunning() {
  return !!html5QrCode;
}

export async function stopBarcodeScanner(readerId = "reader") {
  const readerEl = document.getElementById(readerId);
  const scanner = html5QrCode;
  html5QrCode = null;
  try {
    if (scanner) {
      await scanner.stop();
      scanner.clear();
    }
  } catch (err) {
    console.warn("Error stopping scanner:", err);
  } finally {
    if (readerEl) readerEl.style.display = "none";
  }
}

/**
 * @param {object}   opts
 * @param {string}   [opts.readerId="reader"]  id ng div para sa camera
 * @param {function} opts.onDetected           tinatawag na may (code: string)
 * @param {boolean}  [opts.stopAfterScan=true] isara ang camera pagkatapos mag-scan
 */
export async function startBarcodeScanner({
  readerId = "reader",
  onDetected,
  stopAfterScan = true
}) {
  const readerEl = document.getElementById(readerId);
  if (!readerEl || starting || html5QrCode) return;

  starting = true;
  readerEl.style.display = "block";

  try {
    const cameraId = await pickCameraId();

    // Ang formatsToSupport at experimentalFeatures ay dapat nasa CONSTRUCTOR,
    // hindi sa start(). Kapag nasa start(), hindi ito napapansin ng library.
    html5QrCode = new Html5Qrcode(readerId, {
      verbose: false,
      formatsToSupport: supportedFormats(),
      experimentalFeatures: { useBarCodeDetectorIfSupported: true }
    });

    const scanConfig = {
      fps: 10,
      // Malawak na scan area, sumusunod sa laki ng video
      qrbox: (viewWidth, viewHeight) => ({
        width: Math.floor(viewWidth * 0.9),
        height: Math.floor(viewHeight * 0.5)
      }),
      // HD video + continuous autofocus (kung kaya ng camera)
      videoConstraints: {
        deviceId: { exact: cameraId },
        width: { ideal: 1920 },
        height: { ideal: 1080 },
        advanced: [{ focusMode: "continuous" }]
      }
    };

    let handled = false;

    await html5QrCode.start(
      cameraId,
      scanConfig,
      async (decodedText) => {
        if (handled) return;
        handled = true;

        if (navigator.vibrate) navigator.vibrate(80);
        const code = String(decodedText || "").trim();

        if (stopAfterScan) {
          await stopBarcodeScanner(readerId);
          onDetected(code);
        } else {
          onDetected(code);
          setTimeout(() => (handled = false), 1500);
        }
      },
      () => {} // walang barcode sa frame, huwag mag-ingay
    );
  } catch (err) {
    console.error("Scanner error:", err);
    await stopBarcodeScanner(readerId);
    if (err && err.message === "NO_CAMERA") {
      alert("Walang nakitang camera device.");
    } else {
      alert("Hindi ma-access ang camera. Siguraduhing naka-allow ito.");
    }
  } finally {
    starting = false;
  }
}