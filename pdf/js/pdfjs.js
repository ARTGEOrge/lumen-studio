// pdf.js setup: worker, fonts, cMaps and wasm all served locally (no network).
import * as pdfjsLib from '../vendor/pdfjs/pdf.min.js';
const base = new URL('../vendor/pdfjs/', import.meta.url).href;
pdfjsLib.GlobalWorkerOptions.workerSrc = base + 'pdf.worker.min.js';
export { pdfjsLib };
export const { AnnotationMode, TextLayer, Util } = pdfjsLib;

// bytes are copied because pdf.js transfers the buffer to its worker.
export function loadPdf(bytes, { onPassword, fontExtraProperties = false } = {}) {
  const task = pdfjsLib.getDocument({
    data: bytes.slice(), cMapUrl: base + 'cmaps/', cMapPacked: true, standardFontDataUrl: base + 'standard_fonts/',
    wasmUrl: base + 'wasm/', iccUrl: base + 'iccs/', isEvalSupported: false, enableXfa: false, verbosity: 0, fontExtraProperties
  });
  if (onPassword) task.onPassword = (cb, reason) => onPassword(cb, reason, task);
  return task.promise;
}
