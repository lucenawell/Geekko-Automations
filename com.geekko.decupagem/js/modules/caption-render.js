/**
 * Módulo 4: Render de Captions Simples
 * Gera PNGs com texto das captions
 */

const { createCanvas } = require('canvas');
const fs = require('fs');
const path = require('path');

/**
 * Renderiza caption como PNG simples
 * @param {Object} segment - {text, start, end}
 * @param {string} outputDir - Diretório pra salvar PNGs
 * @param {number} index - Índice da caption
 * @param {Object} options - {width, height, fontSize, fontFamily, bgColor, textColor}
 * @returns {Promise<string>} Caminho do PNG gerado
 */
function renderCaptionPNG(segment, outputDir, index, options = {}) {
  return new Promise((resolve, reject) => {
    try {
      const {
        width = 1920,
        height = 1080,
        fontSize = 48,
        fontFamily = 'Arial',
        bgColor = '#000000',
        textColor = '#FFFFFF',
        padding = 40
      } = options;

      // Criar canvas
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext('2d');

      // Fundo preto
      ctx.fillStyle = bgColor;
      ctx.fillRect(0, 0, width, height);

      // Texto branco, centralizado, na parte inferior
      ctx.fillStyle = textColor;
      ctx.font = `${fontSize}px ${fontFamily}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';

      // Quebrar texto em múltiplas linhas se necessário
      const maxWidth = width - (padding * 2);
      const words = segment.text.split(' ');
      const lines = [];
      let currentLine = '';

      words.forEach((word) => {
        const testLine = currentLine + (currentLine ? ' ' : '') + word;
        const metrics = ctx.measureText(testLine);
        if (metrics.width > maxWidth && currentLine) {
          lines.push(currentLine);
          currentLine = word;
        } else {
          currentLine = testLine;
        }
      });
      if (currentLine) lines.push(currentLine);

      // Desenhar linhas
      const lineHeight = fontSize + 20;
      const totalHeight = lineHeight * lines.length;
      const startY = height - padding - totalHeight;

      lines.forEach((line, i) => {
        ctx.fillText(line, width / 2, startY + (i + 1) * lineHeight);
      });

      // Salvar PNG
      const outputPath = path.join(outputDir, `caption_${String(index).padStart(4, '0')}.png`);
      const buffer = canvas.toBuffer('image/png');
      fs.writeFileSync(outputPath, buffer);

      console.log(`[CaptionRender] Criado: ${outputPath}`);
      resolve(outputPath);
    } catch (err) {
      reject(new Error(`Erro ao renderizar PNG: ${err.message}`));
    }
  });
}

/**
 * Renderiza múltiplas captions
 * @param {Array} segments - Array de {text, start, end}
 * @param {string} outputDir - Diretório pra salvar PNGs
 * @param {Object} options - Opções de render
 * @returns {Promise<Array>} Array de {path, start, end}
 */
async function renderAllCaptions(segments, outputDir, options = {}) {
  // Criar diretório de output
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const results = [];

  for (let i = 0; i < segments.length; i++) {
    try {
      const segment = segments[i];
      const pngPath = await renderCaptionPNG(segment, outputDir, i, options);
      results.push({
        path: pngPath,
        startSeconds: segment.start,
        endSeconds: segment.end,
        text: segment.text
      });
    } catch (err) {
      console.warn(`[CaptionRender] Erro no segmento ${i}: ${err.message}`);
      // Continua com próximo
    }
  }

  console.log(`[CaptionRender] Renderizados ${results.length}/${segments.length} captions`);
  return results;
}

module.exports = {
  renderCaptionPNG,
  renderAllCaptions
};
