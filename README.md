<p align="center">
  <img src="icons/icon-192.png" width="96" height="96" alt="Magnipico icon">
</p>

<h1 align="center">Magnipico</h1>

<p align="center">
  Make small images big. A free image upscaler that runs entirely in your browser.<br>
  <a href="https://nathandailo.github.io/magnipico/"><strong>Open Magnipico →</strong></a>
</p>

---

Magnipico enlarges photos and artwork by 2x to 8x while recovering detail, instead of just stretching pixels. Everything happens on your own device: images are never uploaded, there is nothing to install, and after the first visit it works offline.

## Features

- **Four upscaling models**, each suited to a different kind of image:
  | Model | Best for | Size |
  |---|---|---|
  | Sharp photo | Most photos. Keeps natural texture and fine detail. | 67 MB |
  | Web photo | Blurry or heavily compressed pictures from the web or chat apps. | 30 MB |
  | Fast | Quick results, about 10x faster. Cleaner but less fine detail. | 5 MB |
  | Art & anime | Illustrations, line art, logos and anime. | 18 MB |
- **2x, 3x, 4x, 6x and 8x** scaling.
- **Look controls**: blend strength, sharpening and film grain, for results that don't look overly smooth.
- **Area preview**: upscale just the part of the image you're looking at, in seconds, before committing to the whole thing.
- **Before/after compare** with a draggable split line, zoom (scroll wheel or pinch) and pan.
- **Batch processing**: queue up as many images as you like.
- **Save as PNG, JPEG or WebP.** On phones, saving opens the share sheet so you can save straight to your photos.
- **Light and dark themes**, a short guided tour for first-time users, and a layout that works on phones.
- **Installable**: use the Install button in Chrome or Edge to get Magnipico in its own window with a Start Menu or home-screen icon.

## Browser support

Magnipico uses [WebGPU](https://developer.mozilla.org/docs/Web/API/WebGPU_API) to run on your graphics card.

- **Fast:** recent Chrome or Edge on Windows, macOS, ChromeOS or Android.
- **Works, but slowly:** other browsers fall back to the CPU. The badge in the top-right corner shows which mode is in use.

Speed depends on your hardware and the model you choose. As a guide, on a laptop with integrated graphics the Fast model upscales a small photo in a couple of seconds, while Sharp photo on a 12-megapixel image can take several minutes. Use **Preview area** to check settings first.

## Running it locally

Magnipico is a static site with no build step. Serve the folder with any web server. The included script needs Python 3:

```bash
python serve.py --open
```

This opens `http://localhost:8377`. On Windows you can double-click `Run Magnipico locally.bat` instead. Opening `index.html` directly from disk will not work, because browsers block web workers and service workers on `file://` pages.

## How it works

- `worker.js` does the upscaling in a background thread so the page stays responsive. Each image is split into overlapping 256 × 256 tiles. Every tile is run through the model with [ONNX Runtime Web](https://onnxruntime.ai/), and the results are stitched back together. Scales above 4x run a second pass.
- The strength, sharpen and grain controls are applied after upscaling.
- `sw.js` caches the app and the models on first use, which is what makes it work offline and installable.

```
index.html, styles.css, app.js   interface
worker.js                        upscaling engine
sw.js, manifest.webmanifest      offline support and install
models/                          upscaling models (ONNX)
vendor/ort/                      ONNX Runtime Web 1.31.1
icons/                           app icons
serve.py                         local development server
```

## Credits

Magnipico is built on the work of others. Their licences apply to the files they made:

| Component | Author | Licence |
|---|---|---|
| Sharp photo (4xNomos8kSC) | Philip Hofmann, [Phhofm/models](https://github.com/Phhofm/models) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| Web photo (4xNomosWebPhoto_RealPLKSR) | Philip Hofmann, [Phhofm/models](https://github.com/Phhofm/models) | [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/) |
| Fast (realesr-general-x4v3) | Xintao Wang et al., [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) | BSD 3-Clause |
| Art & anime (RealESRGAN_x4plus_anime_6B) | Xintao Wang et al., [Real-ESRGAN](https://github.com/xinntao/Real-ESRGAN) | BSD 3-Clause |
| ONNX Runtime Web | Microsoft, [onnxruntime](https://github.com/microsoft/onnxruntime) | MIT |

Changes to third-party files: the two Nomos models had the names of their output dimensions changed so they load in ONNX Runtime Web; their weights are unchanged. The Real-ESRGAN models were converted from PyTorch to ONNX.
