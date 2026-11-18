import sharp from 'sharp';

export const FAVICON_SIZE = 64;

// Decode only a bounded raster image, and match the portrait's top-centred
// crop. WebP needs a raster decoder: the SVG renderer does not decode it.
export function photoFavicon(data) {
  return sharp(data, { limitInputPixels: 16_777_216, failOn: 'error' })
    .autoOrient()
    .resize(FAVICON_SIZE, FAVICON_SIZE, { fit: 'cover', position: 'north' })
    .png()
    .toBuffer();
}
