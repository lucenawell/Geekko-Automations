/**
 * Módulo 2: Remoção de Silêncios com FFmpeg
 * Detecta e retorna timestamps de silêncios na timeline
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Usar FFmpeg do PATH (instalado via winget/manual)
const FFMPEG_BIN = 'ffmpeg';

/**
 * Detecta silêncios em um arquivo de áudio usando FFmpeg silencedetect
 * @param {string} audioPath - Caminho absoluto do arquivo .wav
 * @param {number} threshold - Limiar em dB (ex: -35)
 * @param {number} minDuration - Duração mínima em segundos (ex: 0.01)
 * @returns {Promise<Array>} Array com {start_sec, end_sec, duration}
 */
function detectSilences(audioPath, threshold = -35, minDuration = 0.01) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(audioPath)) {
      return reject(new Error(`Arquivo não encontrado: ${audioPath}`));
    }

    const silences = [];
    let ffmpegOutput = '';
    let ffmpegError = '';

    // Construir comando FFmpeg com silencedetect
    const args = [
      '-i', audioPath,
      '-af', `silencedetect=n=${threshold}dB:d=${minDuration}`,
      '-f', 'null',
      '-'
    ];

    const proc = spawn(FFMPEG_BIN, args);

    // Capturar stderr (onde FFmpeg escreve análise)
    proc.stderr.on('data', (data) => {
      ffmpegOutput += data.toString();
    });

    proc.stdout.on('data', (data) => {
      ffmpegError += data.toString();
    });

    proc.on('error', (err) => {
      reject(new Error(`Falha ao executar FFmpeg: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code !== 0 && code !== 1) {
        // code 1 é ok para silencedetect (apenas análise, sem saída de arquivo)
        return reject(new Error(`FFmpeg retornou código ${code}`));
      }

      // Parsear output do FFmpeg
      // Formato esperado:
      // [silencedetect @ 0x...] silence_start: 1.23
      // [silencedetect @ 0x...] silence_end: 4.56 | silence_duration: 3.33
      const silenceStartRegex = /silence_start:\s+([\d.]+)/g;
      const silenceEndRegex = /silence_end:\s+([\d.]+)\s+\|\s+silence_duration:\s+([\d.]+)/g;

      let match;
      const starts = [];

      // Extrair início dos silêncios
      while ((match = silenceStartRegex.exec(ffmpegOutput)) !== null) {
        starts.push(parseFloat(match[1]));
      }

      // Extrair fim dos silêncios e duração
      let index = 0;
      while ((match = silenceEndRegex.exec(ffmpegOutput)) !== null) {
        const end = parseFloat(match[1]);
        const duration = parseFloat(match[2]);
        const start = starts[index] || (end - duration);

        silences.push({
          start_sec: parseFloat(start.toFixed(3)),
          end_sec: parseFloat(end.toFixed(3)),
          duration: parseFloat(duration.toFixed(3))
        });

        index++;
      }

      // Se não achou silêncios com regex, pode ser porque não há silêncios
      resolve(silences);
    });
  });
}

/**
 * Orquestra a detecção completa de silêncios e cleanup
 * @param {string} audioPath - Caminho do arquivo .wav
 * @param {number} threshold - Limiar em dB
 * @param {number} minDuration - Duração mínima em segundos
 * @returns {Promise<Object>} { silences: [...], cleanupDone: boolean }
 */
async function processAudioForSilences(audioPath, threshold = -35, minDuration = 0.01) {
  try {
    console.log(`[SilenceRemoval] Detectando silêncios em: ${path.basename(audioPath)}`);
    console.log(`[SilenceRemoval] Threshold: ${threshold}dB, Min Duration: ${minDuration}s`);

    const silences = await detectSilences(audioPath, threshold, minDuration);

    console.log(`[SilenceRemoval] Encontrados ${silences.length} silêncio(s)`);

    // Cleanup: deletar arquivo .wav após processar
    try {
      if (fs.existsSync(audioPath)) {
        fs.unlinkSync(audioPath);
        console.log(`[SilenceRemoval] Arquivo temporário deletado: ${audioPath}`);
      }
    } catch (cleanupErr) {
      console.warn(`[SilenceRemoval] Aviso ao limpar: ${cleanupErr.message}`);
    }

    return {
      silences: silences,
      cleanupDone: true,
      count: silences.length
    };
  } catch (err) {
    // Tentar cleanup mesmo se houver erro
    try {
      if (fs.existsSync(audioPath)) fs.unlinkSync(audioPath);
    } catch(e) {}
    throw err;
  }
}

module.exports = {
  detectSilences,
  processAudioForSilences
};
