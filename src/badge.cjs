// A small native bitmap avoids depending on fonts or renderer image input.
const glyphs = {
  '0': ['111','101','101','101','111'], '1': ['010','110','010','010','111'],
  '2': ['111','001','111','100','111'], '3': ['111','001','111','001','111'],
  '4': ['101','101','111','001','001'], '5': ['111','100','111','001','111'],
  '6': ['111','100','111','101','111'], '7': ['111','001','010','010','010'],
  '8': ['111','101','111','101','111'], '9': ['111','101','111','001','111'],
  '+': ['000','010','111','010','000']
};
function badgeBitmap(count) {
  const size = 32, pixels = Buffer.alloc(size * size * 4);
  const paint = (x, y, b, g, r) => {
    const offset = (y * size + x) * 4;
    pixels[offset] = b; pixels[offset + 1] = g; pixels[offset + 2] = r; pixels[offset + 3] = 255;
  };
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    if ((x - 15.5) ** 2 + (y - 15.5) ** 2 <= 15.5 ** 2) paint(x, y, 61, 48, 225);
  }
  const text = count > 99 ? '99+' : String(count);
  const scale = text.length > 2 ? 2 : 3;
  const left = Math.floor((size - (text.length * 4 - 1) * scale) / 2);
  const top = Math.floor((size - 5 * scale) / 2);
  [...text].forEach((digit, index) => glyphs[digit].forEach((row, y) => {
    [...row].forEach((bit, x) => {
      if (bit !== '1') return;
      for (let dy = 0; dy < scale; dy++) for (let dx = 0; dx < scale; dx++) {
        paint(left + (index * 4 + x) * scale + dx, top + y * scale + dy, 255, 255, 255);
      }
    });
  }));
  return pixels;
}
module.exports = { badgeBitmap };
